# TODO

Things found in Atrium that are worth fixing, not a plan to rewrite it. Atrium
works and is in daily use; everything below is a rough edge someone walked into,
recorded so the next person walks around it or removes it.

Most of these surfaced on 2026-09-10 while fitting Mandy as the first chamber
cloned from outside the repo rather than symlinked from a sibling checkout. That
is the reason several of them are about the boundary between Atrium and a
chamber it did not grow up with.

## Auth

**1. Navigation detection rests on a header a chamber can erase.**
`isNavigationRequest` in [core/auth.ts](../core/auth.ts) reads `Sec-Fetch-Mode`
and treats anything but `navigate` as an API call, worth a bare 401. Its
`Accept: text/html` fallback only runs when the header is *absent* — so it never
fires for the case that actually breaks, which is a header that is present and
says `cors`.

A chamber's service worker that answers navigations re-issues them with
`fetch(request)`, and that turns `navigate` into `cors`. The page load then gets
a 401 body instead of the redirect to `/login`, and since no document loaded,
the injected script that would notice the 401 never runs either. The user sees
an error with no way to log in.

Domo already works around it — [core/chambers/domo/client/sw.js](../core/chambers/domo/client/sw.js)
declines to touch navigations and says why — but a workaround living in one
chamber's source is not a rule an outside chamber can be expected to know. Mandy
did not, which is how this was found. The workaround also has a price: a service
worker that leaves navigations alone cannot boot its shell offline.

Two ways to stop making it a chamber's problem, neither measured yet:

*   Fall back to `Accept: text/html` whenever `Sec-Fetch-Mode` is not
    `navigate`, rather than only when it is missing. Costs correctness in the
    other direction — an XHR that asks for HTML would get a 302 it cannot
    follow instead of a 401 it can act on.
*   Read `Sec-Fetch-Dest: document` instead. Cleaner *if* it survives the
    re-issue, which is exactly the thing to measure first; it may well come
    through as `empty`, in which case this option does not exist.

**2. Sessions carry no identity and cannot be revoked.** The token is
`expiry.HMAC(expiry)` and nothing else — no nonce, no subject, no issued-at. Two
logins that land in the same millisecond produce the same string, and the only
way to invalidate a cookie before its seven days are up is to rotate
`ATRIUM_SECRET`, which signs out every device at once. That was a fair trade
when the only chamber was a dashboard. It is a worse one now that a chamber
behind this cookie reads and writes the filesystem: a cookie copied off one
machine is good for a week and there is no way to say otherwise.

A random nonce in the signed payload makes tokens distinguishable, which is what
any future revocation list needs to name them. Nothing else has to change to
leave that door open.

Smaller, same file: the credential check is `===` on both fields, so it is not
constant-time. Realistically unexploitable across a network, and cheap enough to
fix that the argument costs more than the fix.

**3. The public-asset bypass is decided by file extension.** `isPublicAsset`
lets through anything whose path ends in an image, font or icon extension, on
any hostname, in any chamber, so a PWA can install before its user logs in. It
does that job. It also means every `.png` and `.svg` a chamber serves is
world-readable to anyone who can reach the host — for icons that is the point,
for a chamber that serves user content under those extensions it is a property
nobody declared and nobody can opt out of.

Not urgent, and possibly correct as-is. What it should not be is accidental: if
the rule is "icons are public", the manifest's icon list is a better source of
truth than the extension, and if a chamber ever wants a private image it needs
some way to say so.

## Chamber loading

**4. One `catch` covers two unrelated failures, and the process starts anyway.**
In [atrium.ts](../atrium.ts) the `try` wraps both the read of `chambers.json`
*and* the whole import loop, catching `Deno.errors.NotFound` to mean "no
chambers.json, that is fine". A chamber that reads a missing file during its own
module initialisation throws the same error class, and it is swallowed the same
way. Verified: every chamber after the failing one silently never registers,
Atrium prints its startup banner, and the only symptom is a 404 for a hostname
that should have worked.

A typo'd `path` in `chambers.json` is fine — a missing module is a `TypeError`,
which rethrows correctly. It is specifically a chamber whose own startup touches
the filesystem that disappears quietly.

The fix is to narrow the `try` to the `readTextFile` call, so the loop's
failures are nobody's idea of a missing config file, and to decide per chamber
whether one bad chamber should take down the process or just log and continue.

**5. `chambers.json` is read through `URL.pathname`.** Same file: the config path
comes from `chambersJsonUrl.pathname`, which is still percent-encoded. Atrium
installed under a path containing a space fails to find its own config and, per
item 4, says nothing about it. `fromFileUrl` from `@std/path` is the one-line
answer.

## Configuration

**6. `import_map.json` is gitignored, and it is the dependency manifest.**
Sharing one top-level set of dependencies instead of ten copies of the same
library is the idea Atrium was started for — and the file that records that set
is untracked, as is `deno.lock`. A fresh clone gets an Atrium that cannot
resolve any chamber's imports, with nothing in the repo saying what they were or
which versions worked.

Ignoring it may well be deliberate, since the contents depend on which chambers
an install actually runs. If so the answer is probably a tracked
`import_map.example.json` carrying Domo's needs and a comment about the rest —
or letting each chamber declare its own dependencies somewhere Atrium reads at
startup, which is a larger change but the one that matches how chambers are
added. Worth deciding rather than leaving as a side effect of `.gitignore`.

**7. `deno task dev` cannot write.** The watch task is missing `--allow-write`,
so any chamber that saves anything fails there while working under
`deno task start`. It bites Domo's config endpoint and Mandy's every save.
[CLAUDE.md](../CLAUDE.md) documents it, which is the wrong shape of fix for a
missing word in a task definition — either add the flag or write down why watch
mode is deliberately read-only.

## Known, and probably fine

**8. Offline plus an expired session is a dead app, for every PWA chamber.** The
injected `sessionCheckScript` is cached inside the chamber's shell, so a cached
app opened offline after the cookie lapses calls `location.replace` to a login
page that cannot load. The user is signed out at that point and the app would
not work anyway, so this costs a clear error message rather than any function. A
service worker could recognise the case and render something honest instead of
letting the redirect fail into a browser error page.

**9. HTML injection buffers the whole response.** `atrium.ts` does
`await response.text()` on every `text/html` reply to splice the script in,
which rules out streaming HTML and re-decodes the body as UTF-8 on the way
through. Fine for the small documents chambers currently serve; worth
remembering before a chamber tries to stream a large one. It also injects into
*any* `text/html`, including error pages and HTML returned from a chamber's own
API — harmless so far, but broader than "pages".
