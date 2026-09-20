/**
 * The workspace is authenticated and session-driven — there is nothing
 * meaningful to prerender, and Clerk's server context isn't available at
 * build time. Force dynamic rendering.
 */
import { PersonaGate } from "@/components/product/PersonaGate";

export const dynamic = "force-dynamic";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <PersonaGate>{children}</PersonaGate>;
}
