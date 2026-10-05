-- =====================================================================
-- Nepantwoord: databaseschema
--
-- Uitgangspunten
-- * De browser leest of schrijft NOOIT rechtstreeks in deze tabellen.
--   RLS staat aan zonder policies, dus de anon-key kan niets zien.
--   Alle toegang loopt via de Next.js API-routes met de service-role-key.
-- * Alle spelacties die moeten samenwerken (fase controleren + opslaan)
--   gebeuren in één transactie via de functies onderaan dit bestand.
-- * Unieke constraints zijn de laatste verdedigingslinie tegen dubbele
--   antwoorden en stemmen, ook bij gelijktijdige verzoeken.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------

create table public.games (
  id               uuid primary key default gen_random_uuid(),
  room_code        text not null unique check (room_code ~ '^[A-Z0-9]{4,6}$'),
  status           text not null default 'LOBBY' check (status in (
                     'LOBBY', 'SUBMITTING_ANSWERS', 'VOTING', 'REVEAL',
                     'SCOREBOARD', 'FINISHED', 'CLOSED')),
  current_question integer not null default 0 check (current_question >= 0),
  host_token_hash  text not null unique,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.players (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 20),
  -- genormaliseerde naam (kleine letters, spaties opgeschoond) voor uniciteit
  name_key      text not null check (char_length(name_key) >= 1),
  token_hash    text not null unique,
  score         integer not null default 0 check (score >= 0),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint players_unique_name unique (game_id, name_key)
);
create index players_game_idx on public.players (game_id);

create table public.questions (
  id                uuid primary key default gen_random_uuid(),
  game_id           uuid not null references public.games (id) on delete cascade,
  position          integer not null check (position between 0 and 4),
  question          text not null check (char_length(question) between 1 and 300),
  correct_answer    text not null check (char_length(correct_answer) between 1 and 80),
  normalized_answer text not null check (char_length(normalized_answer) >= 1),
  constraint questions_unique_position unique (game_id, position)
);

create table public.fake_answers (
  id                uuid primary key default gen_random_uuid(),
  question_id       uuid not null references public.questions (id) on delete cascade,
  player_id         uuid not null references public.players (id) on delete cascade,
  answer            text not null check (char_length(answer) between 1 and 80),
  normalized_answer text not null check (char_length(normalized_answer) >= 1),
  created_at        timestamptz not null default now(),
  -- maximaal één nepantwoord per speler per vraag
  constraint fake_answers_one_per_player unique (question_id, player_id),
  -- nooit twee identieke (genormaliseerde) antwoorden binnen één vraag
  constraint fake_answers_unique_answer unique (question_id, normalized_answer)
);

-- Een nepantwoord mag nooit gelijk zijn aan het juiste antwoord.
-- Dit staat in een trigger zodat het ook op databaseniveau gegarandeerd is.
create function public.fake_answer_not_correct() returns trigger
language plpgsql as $$
begin
  if exists (
    select 1 from public.questions q
    where q.id = new.question_id and q.normalized_answer = new.normalized_answer
  ) then
    raise exception 'CORRECT_ANSWER' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger fake_answers_not_correct
  before insert or update on public.fake_answers
  for each row execute function public.fake_answer_not_correct();

-- De antwoordopties van de stemfase: alle nepantwoorden + het juiste
-- antwoord, in een vaste willekeurige volgorde (zelfde voor iedereen).
create table public.answer_options (
  id             uuid primary key default gen_random_uuid(),
  question_id    uuid not null references public.questions (id) on delete cascade,
  fake_answer_id uuid unique references public.fake_answers (id) on delete cascade,
  is_correct     boolean not null default false,
  text           text not null,
  position       integer not null,
  constraint answer_options_unique_position unique (question_id, position),
  constraint answer_options_kind check (is_correct = (fake_answer_id is null))
);
-- precies één juist antwoord per vraag
create unique index answer_options_one_correct
  on public.answer_options (question_id) where is_correct;

create table public.votes (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete cascade,
  option_id   uuid not null references public.answer_options (id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- maximaal één stem per speler per vraag
  constraint votes_one_per_player unique (question_id, player_id)
);

-- Niet stemmen op je eigen antwoord, en de optie moet bij de vraag horen.
create function public.vote_is_valid() returns trigger
language plpgsql as $$
declare
  v_option public.answer_options;
  v_author uuid;
begin
  select * into v_option from public.answer_options where id = new.option_id;
  if v_option.question_id is distinct from new.question_id then
    raise exception 'INVALID_OPTION' using errcode = 'P0001';
  end if;
  if v_option.fake_answer_id is not null then
    select player_id into v_author from public.fake_answers where id = v_option.fake_answer_id;
    if v_author = new.player_id then
      raise exception 'OWN_ANSWER' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger votes_valid
  before insert or update on public.votes
  for each row execute function public.vote_is_valid();

-- Punten per speler per vraag, vastgelegd bij de onthulling.
create table public.round_scores (
  question_id uuid not null references public.questions (id) on delete cascade,
  player_id   uuid not null references public.players (id) on delete cascade,
  points      integer not null check (points >= 0),
  primary key (question_id, player_id)
);

-- ---------------------------------------------------------------------
-- Afscherming: de browser (anon / authenticated) kan niets.
-- ---------------------------------------------------------------------

alter table public.games          enable row level security;
alter table public.players        enable row level security;
alter table public.questions      enable row level security;
alter table public.fake_answers   enable row level security;
alter table public.answer_options enable row level security;
alter table public.votes          enable row level security;
alter table public.round_scores   enable row level security;

revoke all on public.games, public.players, public.questions, public.fake_answers,
  public.answer_options, public.votes, public.round_scores
  from anon, authenticated;

-- ---------------------------------------------------------------------
-- Spelfuncties
-- Fouten worden gemeld als exception met een vaste code als bericht;
-- de API vertaalt die naar een Nederlandse melding.
-- ---------------------------------------------------------------------

-- Spel aanmaken met vragen (JSON-array van {question, correct_answer, normalized_answer}).
create function public.create_game(p_room_code text, p_host_token_hash text, p_questions jsonb)
returns uuid
language plpgsql as $$
declare
  v_game_id uuid;
  v_count   integer := jsonb_array_length(p_questions);
begin
  if v_count < 1 or v_count > 5 then
    raise exception 'INVALID_QUESTIONS' using errcode = 'P0001';
  end if;

  insert into public.games (room_code, host_token_hash)
  values (p_room_code, p_host_token_hash)
  returning id into v_game_id;

  insert into public.questions (game_id, position, question, correct_answer, normalized_answer)
  select v_game_id, (q.ord - 1)::integer, q.value ->> 'question', q.value ->> 'correct_answer',
         q.value ->> 'normalized_answer'
  from jsonb_array_elements(p_questions) with ordinality as q(value, ord);

  return v_game_id;
end;
$$;

-- Meedoen. Het spel wordt vergrendeld zodat het maximum van 30 spelers
-- ook bij gelijktijdige aanmeldingen klopt.
create function public.join_game(p_room_code text, p_name text, p_name_key text, p_token_hash text)
returns uuid
language plpgsql as $$
declare
  v_game      public.games;
  v_player_id uuid;
begin
  select * into v_game from public.games where room_code = p_room_code for update;
  if not found or v_game.status = 'CLOSED' then
    raise exception 'GAME_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_game.status <> 'LOBBY' then
    raise exception 'GAME_STARTED' using errcode = 'P0001';
  end if;
  if (select count(*) from public.players where game_id = v_game.id) >= 30 then
    raise exception 'GAME_FULL' using errcode = 'P0001';
  end if;

  begin
    insert into public.players (game_id, name, name_key, token_hash)
    values (v_game.id, p_name, p_name_key, p_token_hash)
    returning id into v_player_id;
  exception when unique_violation then
    raise exception 'NAME_TAKEN' using errcode = 'P0001';
  end;

  return v_player_id;
end;
$$;

create function public.kick_player(p_game_id uuid, p_player_id uuid)
returns void
language plpgsql as $$
declare
  v_game public.games;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if v_game.status <> 'LOBBY' then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  delete from public.players where id = p_player_id and game_id = p_game_id;
end;
$$;

create function public.start_game(p_game_id uuid)
returns void
language plpgsql as $$
declare
  v_game public.games;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if v_game.status <> 'LOBBY' then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  if (select count(*) from public.players where game_id = p_game_id) < 2 then
    raise exception 'NOT_ENOUGH_PLAYERS' using errcode = 'P0001';
  end if;
  update public.games
     set status = 'SUBMITTING_ANSWERS', current_question = 0, updated_at = now()
   where id = p_game_id;
end;
$$;

-- Nepantwoord insturen. "for share" voorkomt dat de host tegelijk de fase
-- wisselt, maar laat spelers onderling parallel insturen; de unieke
-- constraints beslissen dan wie er eerst was.
create function public.submit_fake_answer(p_game_id uuid, p_player_id uuid, p_answer text, p_normalized text)
returns void
language plpgsql as $$
declare
  v_game     public.games;
  v_question public.questions;
  v_constraint text;
begin
  select * into v_game from public.games where id = p_game_id for share;
  if v_game.status <> 'SUBMITTING_ANSWERS' then
    raise exception 'PHASE_CLOSED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.players where id = p_player_id and game_id = p_game_id) then
    raise exception 'NOT_A_PLAYER' using errcode = 'P0001';
  end if;

  select * into v_question from public.questions
   where game_id = p_game_id and position = v_game.current_question;

  if v_question.normalized_answer = p_normalized then
    raise exception 'CORRECT_ANSWER' using errcode = 'P0001';
  end if;

  begin
    insert into public.fake_answers (question_id, player_id, answer, normalized_answer)
    values (v_question.id, p_player_id, p_answer, p_normalized);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'fake_answers_one_per_player' then
      raise exception 'ALREADY_SUBMITTED' using errcode = 'P0001';
    end if;
    raise exception 'DUPLICATE_ANSWER' using errcode = 'P0001';
  end;
end;
$$;

-- Naar de stemfase: alle antwoorden + het juiste antwoord in willekeurige volgorde.
create function public.open_voting(p_game_id uuid)
returns void
language plpgsql as $$
declare
  v_game     public.games;
  v_question public.questions;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if v_game.status <> 'SUBMITTING_ANSWERS' then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  select * into v_question from public.questions
   where game_id = p_game_id and position = v_game.current_question;

  insert into public.answer_options (question_id, fake_answer_id, is_correct, text, position)
  select v_question.id, o.fake_answer_id, o.is_correct, o.text,
         (row_number() over (order by random()))::integer
  from (
    select f.id as fake_answer_id, false as is_correct, f.answer as text
      from public.fake_answers f where f.question_id = v_question.id
    union all
    select null, true, v_question.correct_answer
  ) o;

  update public.games set status = 'VOTING', updated_at = now() where id = p_game_id;
end;
$$;

create function public.cast_vote(p_game_id uuid, p_player_id uuid, p_option_id uuid)
returns void
language plpgsql as $$
declare
  v_game     public.games;
  v_question public.questions;
begin
  select * into v_game from public.games where id = p_game_id for share;
  if v_game.status <> 'VOTING' then
    raise exception 'PHASE_CLOSED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.players where id = p_player_id and game_id = p_game_id) then
    raise exception 'NOT_A_PLAYER' using errcode = 'P0001';
  end if;
  select * into v_question from public.questions
   where game_id = p_game_id and position = v_game.current_question;

  begin
    insert into public.votes (question_id, player_id, option_id)
    values (v_question.id, p_player_id, p_option_id);
  exception
    when unique_violation then
      raise exception 'ALREADY_VOTED' using errcode = 'P0001';
    when foreign_key_violation then
      raise exception 'INVALID_OPTION' using errcode = 'P0001';
  end;
end;
$$;

-- Onthullen + punten vastleggen. Draait precies één keer per vraag dankzij
-- de statuscontrole onder "for update".
--   juiste antwoord geraden:         +2
--   iemand stemt op jouw nepantwoord: +1 per stem
create function public.reveal_answers(p_game_id uuid)
returns void
language plpgsql as $$
declare
  v_game     public.games;
  v_question public.questions;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if v_game.status <> 'VOTING' then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  select * into v_question from public.questions
   where game_id = p_game_id and position = v_game.current_question;

  insert into public.round_scores (question_id, player_id, points)
  select v_question.id, p.id,
         coalesce((
           select 2 from public.votes v
             join public.answer_options o on o.id = v.option_id
            where v.question_id = v_question.id and v.player_id = p.id and o.is_correct
         ), 0)
         + (
           select count(*)::integer from public.votes v
             join public.answer_options o on o.id = v.option_id
             join public.fake_answers f on f.id = o.fake_answer_id
            where v.question_id = v_question.id and f.player_id = p.id and v.player_id <> p.id
         )
  from public.players p
  where p.game_id = p_game_id;

  update public.players p
     set score = p.score + rs.points
    from public.round_scores rs
   where rs.player_id = p.id and rs.question_id = v_question.id;

  update public.games set status = 'REVEAL', updated_at = now() where id = p_game_id;
end;
$$;

create function public.show_scoreboard(p_game_id uuid)
returns void
language plpgsql as $$
declare
  v_game public.games;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if v_game.status <> 'REVEAL' then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  update public.games set status = 'SCOREBOARD', updated_at = now() where id = p_game_id;
end;
$$;

create function public.next_question(p_game_id uuid)
returns void
language plpgsql as $$
declare
  v_game  public.games;
  v_total integer;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if v_game.status <> 'SCOREBOARD' then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  select count(*) into v_total from public.questions where game_id = p_game_id;
  if v_game.current_question + 1 >= v_total then
    raise exception 'NO_MORE_QUESTIONS' using errcode = 'P0001';
  end if;
  update public.games
     set status = 'SUBMITTING_ANSWERS', current_question = v_game.current_question + 1,
         updated_at = now()
   where id = p_game_id;
end;
$$;

create function public.finish_game(p_game_id uuid)
returns void
language plpgsql as $$
declare
  v_game  public.games;
  v_total integer;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if v_game.status <> 'SCOREBOARD' then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  select count(*) into v_total from public.questions where game_id = p_game_id;
  if v_game.current_question + 1 < v_total then
    raise exception 'QUESTIONS_LEFT' using errcode = 'P0001';
  end if;
  update public.games set status = 'FINISHED', updated_at = now() where id = p_game_id;
end;
$$;

-- Opnieuw spelen met dezelfde vragen en dezelfde spelers.
create function public.restart_game(p_game_id uuid)
returns void
language plpgsql as $$
declare
  v_game public.games;
begin
  select * into v_game from public.games where id = p_game_id for update;
  if v_game.status <> 'FINISHED' then
    raise exception 'INVALID_STATE' using errcode = 'P0001';
  end if;
  delete from public.round_scores rs using public.questions q
   where rs.question_id = q.id and q.game_id = p_game_id;
  delete from public.votes v using public.questions q
   where v.question_id = q.id and q.game_id = p_game_id;
  delete from public.answer_options o using public.questions q
   where o.question_id = q.id and q.game_id = p_game_id;
  delete from public.fake_answers f using public.questions q
   where f.question_id = q.id and q.game_id = p_game_id;
  update public.players set score = 0 where game_id = p_game_id;
  update public.games
     set status = 'LOBBY', current_question = 0, updated_at = now()
   where id = p_game_id;
end;
$$;

create function public.close_game(p_game_id uuid)
returns void
language plpgsql as $$
begin
  update public.games set status = 'CLOSED', updated_at = now() where id = p_game_id;
end;
$$;

-- Alleen de server (service role) mag de functies aanroepen.
do $$
declare
  f text;
begin
  foreach f in array array[
    'create_game(text, text, jsonb)',
    'join_game(text, text, text, text)',
    'kick_player(uuid, uuid)',
    'start_game(uuid)',
    'submit_fake_answer(uuid, uuid, text, text)',
    'open_voting(uuid)',
    'cast_vote(uuid, uuid, uuid)',
    'reveal_answers(uuid)',
    'show_scoreboard(uuid)',
    'next_question(uuid)',
    'finish_game(uuid)',
    'restart_game(uuid)',
    'close_game(uuid)',
    'fake_answer_not_correct()',
    'vote_is_valid()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;
