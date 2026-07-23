"use client";

import Image from "next/image";
import { signIn, signOut, useSession } from "@/lib/auth-client";

export default function Home() {
  const { data: session, isPending } = useSession();

  const handleSignIn = async () => {
    await signIn.social({
      provider: "github",
      callbackURL: "/",
    });
  };

  const handleSignOut = async () => {
    await signOut();
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#030303] text-zinc-100 font-sans">
      {/* Background gradients */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_800px_at_100%_200px,#1a1a2e,transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_800px_at_0%_800px,#0d1117,transparent)]" />

      {/* Main card */}
      <div className="relative z-10 w-full max-w-md px-6">
        <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/40 p-8 shadow-2xl backdrop-blur-xl transition-all duration-500 hover:border-zinc-700/60">
          
          {/* Header */}
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-800/80 border border-zinc-700/50 shadow-inner">
              <svg
                className="h-6 w-6 text-zinc-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Drag SignIn
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Auth gateway
            </p>
          </div>

          <div className="mt-8 border-t border-zinc-800/80 pt-6">
            {isPending ? (
              /* Loading State */
              <div className="flex flex-col items-center py-4 space-y-4">
                <div className="h-16 w-16 animate-pulse rounded-full bg-zinc-800" />
                <div className="h-4 w-32 animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-48 animate-pulse rounded bg-zinc-800" />
              </div>
            ) : session ? (
              /* Authenticated State */
              <div className="flex flex-col items-center space-y-6">
                <div className="group relative">
                  {session.user.image ? (
                    <div className="relative h-20 w-20 overflow-hidden rounded-full ring-2 ring-zinc-700 ring-offset-2 ring-offset-zinc-950 transition-all duration-300 group-hover:ring-zinc-400">
                      <Image
                        src={session.user.image}
                        alt={session.user.name}
                        width={80}
                        height={80}
                        className="rounded-full object-cover"
                        priority
                      />
                    </div>
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-zinc-800 ring-2 ring-zinc-700 ring-offset-2 ring-offset-zinc-950 text-2xl font-semibold text-zinc-300">
                      {session.user.name.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <span className="absolute bottom-0 right-0 h-4 w-4 rounded-full border-2 border-zinc-950 bg-emerald-500" />
                </div>

                <div className="text-center">
                  <h2 className="text-lg font-medium text-white">
                    {session.user.name}
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {session.user.email}
                  </p>
                </div>

                <button
                  onClick={handleSignOut}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-zinc-800/80 border border-zinc-700/50 px-4 py-3 text-sm font-semibold text-white transition-all duration-200 hover:bg-zinc-800 hover:border-zinc-600 hover:text-red-400 hover:shadow-lg active:scale-95 cursor-pointer"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                    />
                  </svg>
                  Sign Out
                </button>
              </div>
            ) : (
              /* Unauthenticated State */
              <div className="space-y-4">
                <button
                  onClick={handleSignIn}
                  className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3.5 text-sm font-bold text-zinc-950 transition-all duration-200 hover:bg-zinc-200 hover:shadow-xl active:scale-[0.98] cursor-pointer"
                >
                  {/* GitHub SVG */}
                  <svg
                    className="h-5 w-5 fill-current"
                    viewBox="0 0 24 24"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
                  </svg>
                  Sign in with GitHub
                </button>
              </div>
            )}
          </div>
        </div>
        
        {/* Footer */}
      </div>
    </div>
  );
}
