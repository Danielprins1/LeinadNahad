import { HostGame } from '@/components/host/HostGame';

export default async function HostPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <HostGame code={code.toUpperCase()} />;
}
