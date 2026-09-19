/**
 * The workspace is authenticated and session-driven — there is nothing
 * meaningful to prerender, and Clerk's server context isn't available at
 * build time. Force dynamic rendering.
 */
export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
