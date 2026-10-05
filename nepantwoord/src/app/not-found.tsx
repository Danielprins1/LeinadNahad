import Link from 'next/link';
import { Screen, Stack } from '@/components/ui';

export default function NotFound() {
  return (
    <Screen>
      <Stack>
        <h1 className="ui-title">Pagina niet gevonden</h1>
        <p className="ui-muted">Deze pagina bestaat niet.</p>
        <Link href="/" className="ui-button ui-button--primary ui-button--block">
          Terug naar start
        </Link>
      </Stack>
    </Screen>
  );
}
