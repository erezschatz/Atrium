/**
 * The contract every chamber must satisfy.
 * A chamber is imported as a library — it never owns a server.
 */
export interface Chamber {
  /** Full hostname this chamber handles (e.g. "music.atrium.local", "blog.example.com"). Set by atrium.ts at startup from chambers.json; chambers themselves leave this as "". */
  domain: string;
  /** Human-readable name shown in the reception dashboard. */
  displayName: string;
  /** Standard Fetch API handler — receives a Request, returns a Response. */
  fetch: (req: Request) => Response | Promise<Response>;
}
