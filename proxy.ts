import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Adding and editing trips needs an account; the home page explains itself to signed-out visitors.
const needsAccount = createRouteMatcher(["/trips(.*)"]);

// Our own sign-in/up pages, set here rather than in env vars: they aren't secrets.
export default clerkMiddleware(
  async (auth, req) => {
    if (needsAccount(req)) await auth.protect();
  },
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
