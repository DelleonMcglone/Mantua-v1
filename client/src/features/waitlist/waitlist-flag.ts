import { cleanEnv } from "@/lib/env.ts";

/** `VITE_WAITLIST_FRONT_DOOR=1` at build time: logged-out visitors see the
 *  waitlist instead of the app (`/login` is the way in). Off by default. */
export const WAITLIST_FRONT_DOOR =
  cleanEnv(import.meta.env.VITE_WAITLIST_FRONT_DOOR as string | undefined) === "1";
