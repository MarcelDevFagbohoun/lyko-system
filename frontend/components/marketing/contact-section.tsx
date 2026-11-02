"use client";

import * as React from "react";
import { Phone, MessageCircle, Send, CheckCircle2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { CONTACT } from "@/components/marketing/contact";
import { SectionHeading } from "@/components/marketing/section-heading";
import { Field, Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type FormState = {
  firstName: string;
  lastName: string;
  companyName: string;
  phone: string;
  subject: string;
  description: string;
  website: string; // piège anti-spam, jamais rempli par un humain
};

const EMPTY: FormState = { firstName: "", lastName: "", companyName: "", phone: "", subject: "", description: "", website: "" };

/**
 * Section Contact de la page d'accueil (demande utilisateur, 2026-11-02) : photo + numéro cliquable à
 * gauche, formulaire à droite. Le formulaire envoie un e-mail à l'équipe (`POST /api/contact`, public,
 * aucun compte requis) — pas de stockage ni de compte créé, juste un message transmis.
 */
export function ContactSection() {
  const [form, setForm] = React.useState<FormState>(EMPTY);
  const [errors, setErrors] = React.useState<Partial<Record<keyof FormState, string>>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [globalError, setGlobalError] = React.useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => (e[key] ? { ...e, [key]: undefined } : e));
  }

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.firstName.trim()) next.firstName = "Prénom requis.";
    if (!form.lastName.trim()) next.lastName = "Nom requis.";
    if (!form.phone.trim() || form.phone.replace(/\D/g, "").length < 6) next.phone = "Numéro de téléphone invalide.";
    if (!form.subject.trim()) next.subject = "Objet requis.";
    if (!form.description.trim()) next.description = "Dites-nous-en un peu plus.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setGlobalError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      await apiFetch<{ sent: true }>("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          companyName: form.companyName.trim() || undefined,
          phone: form.phone.trim(),
          subject: form.subject.trim(),
          description: form.description.trim(),
          website: form.website,
        }),
      });
      setSent(true);
      setForm(EMPTY);
    } catch (err) {
      setGlobalError(err instanceof ApiError ? err.message : "Échec de l'envoi — vérifiez votre connexion et réessayez.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section id="contact" className="scroll-mt-20 bg-surface-muted py-14 sm:py-20">
      <div className="content-shell">
        <SectionHeading eyebrow="Contact" title="Parlons de votre portefeuille" description="Une question, une démonstration, un besoin précis : écrivez-nous ou appelez directement." />

        <div className="mt-12 grid items-start gap-10 lg:grid-cols-2">
          {/* Photo + numéro — animation d'entrée au survol, cohérente avec le reste de la page. */}
          <div className="flex flex-col gap-6">
            <div className="group relative overflow-hidden rounded-2xl shadow-xl ring-1 ring-border">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/img/contact.webp"
                alt="Une conseillère Africa Immo Management au téléphone, prête à répondre à vos questions"
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
              />
              <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-black/0" />
              <a
                href={`tel:${CONTACT.phoneTel}`}
                className="absolute bottom-4 left-4 right-4 flex items-center gap-3 rounded-xl bg-white/95 px-4 py-3 shadow-lg backdrop-blur transition-transform duration-300 hover:scale-[1.02] sm:right-auto sm:w-fit"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white animate-pulse-dot">
                  <Phone size={18} />
                </span>
                <span className="flex flex-col">
                  <span className="font-label-sm text-ink-muted">Appelez-nous</span>
                  <span className="font-label-md text-ink">{CONTACT.phone}</span>
                </span>
              </a>
            </div>

            {CONTACT.whatsappUrl && (
              <a
                href={CONTACT.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 self-start rounded-full border border-border-strong bg-surface px-5 py-2.5 font-label-md text-ink transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:text-primary hover:shadow-md"
              >
                <MessageCircle size={16} /> Nous écrire sur WhatsApp
              </a>
            )}
          </div>

          {/* Formulaire */}
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm sm:p-8">
            {sent ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center animate-page-in">
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success-bg text-success-fg">
                  <CheckCircle2 size={28} />
                </span>
                <p className="font-label-lg text-ink">Message envoyé !</p>
                <p className="max-w-xs text-body-sm text-ink-muted">
                  Merci, nous revenons vers vous rapidement — par téléphone ou WhatsApp.
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSent(false)}>
                  Envoyer un autre message
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field label="Prénom" htmlFor="contact-firstName" required error={errors.firstName}>
                    <Input id="contact-firstName" value={form.firstName} onChange={(e) => set("firstName", e.target.value)} autoComplete="given-name" />
                  </Field>
                  <Field label="Nom" htmlFor="contact-lastName" required error={errors.lastName}>
                    <Input id="contact-lastName" value={form.lastName} onChange={(e) => set("lastName", e.target.value)} autoComplete="family-name" />
                  </Field>
                </div>

                <Field label="Nom de l'entreprise" htmlFor="contact-companyName" hint="Facultatif">
                  <Input id="contact-companyName" value={form.companyName} onChange={(e) => set("companyName", e.target.value)} autoComplete="organization" />
                </Field>

                <Field label="Numéro de téléphone" htmlFor="contact-phone" required error={errors.phone}>
                  <Input id="contact-phone" type="tel" value={form.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel" placeholder="01 52 93 37 15" />
                </Field>

                <Field label="Objet" htmlFor="contact-subject" required error={errors.subject}>
                  <Input id="contact-subject" value={form.subject} onChange={(e) => set("subject", e.target.value)} placeholder="Ex. démonstration, tarifs, une question..." />
                </Field>

                <Field label="Message" htmlFor="contact-description" required error={errors.description}>
                  <textarea
                    id="contact-description"
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                    rows={4}
                    className={cn(
                      "flex w-full rounded border border-border-strong bg-surface px-3 py-2 text-body-md text-ink",
                      "placeholder:text-ink-faint",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface",
                    )}
                    placeholder="Décrivez votre besoin en quelques mots..."
                  />
                </Field>

                {/* Piège anti-spam : invisible et inatteignable au clavier pour un humain, mais présent dans le DOM pour un robot. */}
                <div aria-hidden="true" className="absolute left-[-9999px] top-auto h-0 w-0 overflow-hidden">
                  <label htmlFor="contact-website">Site web</label>
                  <input id="contact-website" type="text" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} />
                </div>

                {globalError && <p className="text-body-sm text-danger-fg">{globalError}</p>}

                <Button type="submit" size="lg" disabled={submitting} className="mt-1 self-start">
                  <Send size={16} className={submitting ? "animate-pulse" : undefined} />
                  {submitting ? "Envoi..." : "Envoyer le message"}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
