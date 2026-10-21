import type { Metadata } from "next";
import { LegalPage, Section } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Mentions légales" };

export default function MentionsLegalesPage() {
  return (
    <LegalPage title="Mentions légales">
      <Section title="Éditeur du service">
        <ul>
          <li>Dénomination : {LEGAL.name}</li>
          {LEGAL.director && <li>Directeur de la publication : {LEGAL.director}</li>}
          {LEGAL.rccm && <li>RCCM : {LEGAL.rccm}</li>}
          {LEGAL.ifu && <li>IFU : {LEGAL.ifu}</li>}
          {LEGAL.address && <li>Adresse : {LEGAL.address}</li>}
          {LEGAL.email && <li>Contact : {LEGAL.email}</li>}
        </ul>
      </Section>
      <Section title="Hébergement">
        <p>
          Le service est hébergé sur des serveurs sécurisés ; les coordonnées exactes de l&apos;hébergeur sont
          communiquées sur demande à l&apos;adresse de contact ci-dessus.
        </p>
      </Section>
      <Section title="Paiements">
        <p>
          Les paiements en ligne sont traités par FedaPay, prestataire de paiement agréé. {LEGAL.name} ne conserve
          aucun numéro de carte ni code secret de paiement.
        </p>
      </Section>
      <Section title="Propriété intellectuelle">
        <p>
          La marque, le logo, le logiciel et les contenus du site sont la propriété de {LEGAL.name}. Toute
          reproduction sans autorisation écrite est interdite. Les données saisies par chaque entreprise cliente
          restent sa propriété.
        </p>
      </Section>
    </LegalPage>
  );
}
