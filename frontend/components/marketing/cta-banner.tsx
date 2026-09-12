import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CtaBanner() {
  return (
    <section className="content-shell pb-14 sm:pb-20">
      <div className="flex flex-col items-center gap-5 rounded-xl bg-primary px-6 py-12 text-center sm:px-12">
        <h2 className="font-display text-headline-xl text-white">
          Prêt à digitaliser la gestion de votre entreprise ?
        </h2>
        <p className="max-w-xl text-body-lg text-white/85">
          Créez votre espace en quelques minutes et invitez vos employés dès aujourd&apos;hui.
        </p>
        <Link
          href="/inscription"
          className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "border-transparent bg-white hover:bg-white/90")}
        >
          Créer mon compte
        </Link>
      </div>
    </section>
  );
}
