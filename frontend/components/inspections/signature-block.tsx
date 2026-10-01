import { AuthenticatedImage } from "@/components/ui/authenticated-image";

/** Affiche une signature capturée à la finalisation, ou un espace vide si absente. */
export function SignatureBlock({
  label,
  url,
  accessToken,
}: {
  label: string;
  url: string | null;
  accessToken: string | null;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-label-sm text-ink-muted">{label}</span>
      <div className="flex h-24 items-center justify-center rounded-lg border border-border bg-surface-muted">
        {url && accessToken ? (
          <AuthenticatedImage src={url} accessToken={accessToken} alt={label} className="h-full object-contain" />
        ) : (
          <span className="text-body-xs text-ink-faint">Non signée</span>
        )}
      </div>
    </div>
  );
}
