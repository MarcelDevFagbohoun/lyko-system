import type { Metadata } from "next";
import { LegalPage, Section } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Politique de confidentialité" };

export default function ConfidentialitePage() {
  return (
    <LegalPage title="Politique de confidentialité">
      <Section title="Qui est responsable de quoi">
        <p>
          Pour les données de ses propres clients (nom de l&apos;entreprise, identifiants, abonnement, paiements
          d&apos;abonnement), {LEGAL.name} est responsable du traitement. Pour les données que chaque entreprise
          saisit dans son espace (locataires, propriétaires, baux, loyers, employés), c&apos;est l&apos;entreprise
          elle-même qui est responsable ; {LEGAL.name} agit comme prestataire technique et ne les utilise que pour
          fournir le service.
        </p>
      </Section>
      <Section title="Données que nous collectons">
        <ul>
          <li>Compte de l&apos;entreprise : nom, RCCM, IFU, pays, adresse e-mail et téléphone du responsable.</li>
          <li>Utilisation du service : connexions, actions effectuées dans l&apos;espace (journal d&apos;activité).</li>
          <li>Abonnement : offre choisie, montants, références de paiement. Nous ne voyons jamais vos numéros de carte ni de compte Mobile Money : ils restent chez FedaPay.</li>
        </ul>
      </Section>
      <Section title="Pourquoi">
        <p>
          Fournir le service, sécuriser les comptes, facturer les abonnements, envoyer les e-mails nécessaires
          (vérification, rappels d&apos;échéance, factures) et respecter nos obligations légales.
        </p>
      </Section>
      <Section title="Cloisonnement et sécurité">
        <p>
          Chaque entreprise a un espace cloisonné : ses données ne sont visibles par aucune autre entreprise. Les
          mots de passe sont stockés sous forme chiffrée irréversible, les échanges sont chiffrés (HTTPS) et les
          clés de paiement sont chiffrées.
        </p>
      </Section>
      <Section title="Partage">
        <p>
          Nous ne vendons aucune donnée. Elles ne sont communiquées qu&apos;à nos prestataires strictement
          nécessaires (paiement : FedaPay ; envoi d&apos;e-mails : Resend ; hébergement) ou sur demande d&apos;une
          autorité compétente.
        </p>
      </Section>
      <Section title="Conservation">
        <p>
          Les données sont conservées pendant la durée de l&apos;abonnement puis le temps nécessaire aux obligations
          légales et comptables. Une entreprise peut demander l&apos;export ou la suppression de ses données.
        </p>
      </Section>
      <Section title="Vos droits">
        <p>
          Vous pouvez demander l&apos;accès, la rectification ou la suppression de vos données
          {LEGAL.email ? <> en écrivant à {LEGAL.email}</> : " via le contact indiqué dans les mentions légales"}.
        </p>
      </Section>
    </LegalPage>
  );
}
