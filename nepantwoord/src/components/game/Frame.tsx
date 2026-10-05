'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Screen, Spinner, Stack, Card } from '@/components/ui';
import type { LoadState } from '@/lib/client/useGame';

/** Gemeenschappelijke omlijsting: verbindingsmelding en laad-/foutschermen. */
export function GameFrame({
  wide,
  state,
  offline,
  noSession,
  children,
}: {
  wide?: boolean;
  state: LoadState;
  offline: boolean;
  noSession: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {offline && state.kind === 'ready' && (
        <div className="ui-banner" role="status">
          Verbinding verbroken. Opnieuw verbinden…
        </div>
      )}
      <Screen wide={wide}>
        {state.kind === 'loading' && (
          <Stack>
            <Spinner />
            <p className="ui-center ui-muted">Spel laden…</p>
            {offline && <p className="ui-center ui-muted">Geen verbinding. We blijven het proberen…</p>}
          </Stack>
        )}
        {state.kind === 'no-session' && noSession}
        {state.kind === 'ended' && (
          <Card>
            <Stack>
              <h1 className="ui-subtitle">
                {state.reason === 'not-found' ? 'Dit spel bestaat niet (meer).' : 'Je doet niet meer mee aan dit spel.'}
              </h1>
              <p className="ui-muted">
                {state.reason === 'not-found'
                  ? 'Controleer de roomcode of start een nieuw spel.'
                  : 'Mogelijk heeft de host je uit de lobby verwijderd.'}
              </p>
              <Link href="/" className="ui-button ui-button--primary ui-button--block">
                Terug naar start
              </Link>
            </Stack>
          </Card>
        )}
        {state.kind === 'ready' && children}
      </Screen>
    </>
  );
}
