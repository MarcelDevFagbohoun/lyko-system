import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CONTACT } from "@/components/marketing/contact";
import { cn } from "@/lib/utils";

export function CtaBanner() {
  return (
    <section className="content-shell py-14 sm:py-20">
      <div className="flex flex-col items-center gap-5 rounded-xl bg-primary px-6 py-12 text-center sm:px-12">
        <h2 className="font-display text-headline-xl text-white">Reprenez la main sur vos loyers, vos charges et vos comptes.</h2>
        <p className="max-w-xl text-body-lg text-white/85">
          Créez l&apos;espace de votre entreprise en quelques minutes et invitez vos employés dès aujourd&apos;hui.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/inscription"
            className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "border-transparent bg-white hover:bg-white/90")}
          >
            Créer mon compte
          </Link>
          <Link
            href="/connexion"
            className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "border-white/40 bg-transparent !text-white hover:bg-white/10")}
          >
            Se connecter
          </Link>
          {CONTACT.whatsappUrl && (
            <a
              href={CONTACT.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "secondary", size: "lg" }), "border-white/40 bg-transparent !text-white hover:bg-white/10")}
            >
              <MessageCircle size={18} aria-hidden /> Nous écrire sur WhatsApp
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
