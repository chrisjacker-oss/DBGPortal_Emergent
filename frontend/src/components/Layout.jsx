import { Navigation } from "@/components/Navigation";

export default function Layout({ children }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Navigation />
      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}

export function PageHeader({ overline, title, children }) {
  return (
    <div className="flex items-end justify-between border-b border-border px-8 py-6 bg-card sticky top-0 z-10">
      <div>
        <div className="overline text-muted-foreground">{overline}</div>
        <h1 className="font-display font-bold tracking-tight text-3xl mt-1">{title}</h1>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
