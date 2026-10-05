'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { Button, Screen, Stack, TextField, Alert } from '@/components/ui';
import { api, ClientError } from '@/lib/client/api';
import { saveSession, sessionFor } from '@/lib/client/session';
import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH } from '@/lib/constants';
import { useSearchParams } from 'next/navigation';

function JoinForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [code, setCode] = useState(() => (params.get('code') ?? '').toUpperCase());
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Al in deze room? Dan direct terug naar het spel.
  useEffect(() => {
    if (code.length === ROOM_CODE_LENGTH && sessionFor(code, 'player')) router.replace(`/spel/${code}`);
  }, [code, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const cleanCode = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (cleanCode.length < 4) return setError('Vul een geldige roomcode in.');
    if (!name.trim()) return setError('Vul je naam in.');
    setBusy(true);
    setError(null);
    try {
      const res = await api.join(cleanCode, name);
      saveSession({ role: 'player', roomCode: res.roomCode, token: res.playerToken, playerId: res.playerId, name: res.name });
      router.push(`/spel/${res.roomCode}`);
    } catch (err) {
      setError(err instanceof ClientError ? err.message : 'Er ging iets mis. Probeer het opnieuw.');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Stack>
        <TextField
          label="Roomcode"
          className="ui-input--code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={6}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          placeholder="ABCDE"
          required
        />
        <TextField
          label="Naam"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="nickname"
          placeholder="Je naam"
          hint={`Maximaal ${MAX_NAME_LENGTH} tekens. Iedere naam kan maar één keer voorkomen in een room.`}
          required
        />
        {error && <Alert kind="error">{error}</Alert>}
        <Button type="submit" block loading={busy}>
          Meedoen
        </Button>
      </Stack>
    </form>
  );
}

export default function JoinPage() {
  return (
    <Screen>
      <Stack gap="lg">
        <h1 className="ui-title">Meedoen</h1>
        <Suspense>
          <JoinForm />
        </Suspense>
        <Link href="/" className="ui-button ui-button--ghost ui-button--block">
          Terug
        </Link>
      </Stack>
    </Screen>
  );
}
