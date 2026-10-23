import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

// Fake, in-memory session for the UI phase. Replaced by Clerk later.
type Session = {
  signedIn: boolean;
  signIn: () => void;
  signOut: () => void;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(false);
  const value = useMemo(
    () => ({ signedIn, signIn: () => setSignedIn(true), signOut: () => setSignedIn(false) }),
    [signedIn],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside SessionProvider');
  return ctx;
}
