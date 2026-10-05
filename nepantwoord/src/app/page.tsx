'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Screen, Stack, Card } from '@/components/ui';
import { APP_NAME } from '@/lib/constants';
import { loadSession, type StoredSession } from '@/lib/client/session';

export default function StartPage() {
  const [saved, setSaved] = useState<StoredSession | null>(null);
  useEffect(() => setSaved(loadSession()), []);

  return (
    <Screen>
      <Stack gap="lg">
        <Stack gap="sm">
          <h1 className="ui-title ui-center">{APP_NAME}</h1>
          <p className="ui-muted ui-center">
            Verzin een geloofwaardig nepantwoord, laat de anderen erin trappen en raad zelf welk antwoord echt is.
          </p>
        </Stack>

        <Stack>
          <Link href="/nieuw" className="ui-button ui-button--primary ui-button--block">
            Spel starten
          </Link>
          <Link href="/meedoen" className="ui-button ui-button--secondary ui-button--block">
            Meedoen
          </Link>
        </Stack>

        {saved && (
          <Card muted>
            <Stack gap="sm">
              <p className="ui-small">
                Je zat nog in een spel ({saved.role === 'host' ? 'als host' : `als ${saved.name ?? 'speler'}`}, room{' '}
                <strong>{saved.roomCode}</strong>).
              </p>
              <Link
                href={saved.role === 'host' ? `/host/${saved.roomCode}` : `/spel/${saved.roomCode}`}
                className="ui-button ui-button--ghost ui-button--block"
              >
                Terug naar het spel
              </Link>
            </Stack>
          </Card>
        )}
      </Stack>
    </Screen>
  );
}
