import { PlayerGame } from '@/components/player/PlayerGame';

export default async function PlayerPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <PlayerGame code={code.toUpperCase()} />;
}
