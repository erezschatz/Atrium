import { join } from "node:path";
import type { Chamber } from "../../types.ts";
import { handleApi, setChambers } from "./server.ts";
export { setChambers };
import { makeSpaHandler } from "../../static.ts";

const CLIENT_DIR = join(import.meta.dirname!, "client");
const spaHandler = makeSpaHandler(CLIENT_DIR);

const fetch = (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    return handleApi(req, url);
  }
  return spaHandler(req);
};

export default {
  domain: "",
  displayName: "Domo",
  fetch,
} satisfies Chamber;

if (import.meta.main) {
  const port = parseInt(Deno.env.get("DOMO_PORT") ?? "8585", 10);
  console.log(`Domo standalone · http://localhost:${port}`);
  Deno.serve({ port }, fetch);
}
