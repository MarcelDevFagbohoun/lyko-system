import type { Metadata } from "next";
import { LegalPage, Section } from "@/components/legal/legal-page";
import { LEGAL } from "@/lib/legal";

export const metadata: Metadata = { title: "Conditions d’utilisation" };

export default function CguPage() {
  return (
    <LegalPage title="Conditions générales d’utilisation et de vente">
      <Section title="1. Objet">
        <p>
          {LEGAL.name} est un logiciel en ligne de gestion locative (biens, propriétaires, locataires, loyers,
          charges, comptabilité). Les présentes conditions encadrent l&apos;utilisation du service par
          l&apos;entreprise qui crée un compte (« le Client »).
        </p>
      </Section>
      <Section title="2. Compte">
        <p>
          Le Client garantit l&apos;exactitude des informations fournies à l&apos;inscription et reste responsable
          de la confidentialité des identifiants de ses utilisateurs et des actions réalisées avec ceux-ci.
        </p>
      </Section>
      <Section title="3. Offres, prix et paiement">
        <ul>
          <li>Les offres, leurs fonctions, leurs limites (unités, propriétaires) et leurs prix en FCFA sont ceux affichés sur la page « Tarifs » au moment de l&apos;achat.</li>
          <li>L&apos;abonnement est payé à l&apos;avance pour la durée choisie, en ligne via FedaPay. Il n&apos;y a pas de période d&apos;essai gratuite.</li>
          <li>Une facture est émise pour chaque paiement confirmé et reste disponible dans l&apos;espace Abonnement.</li>
          <li>Un tarif de lancement peut être proposé à un nombre limité de premières entreprises ; il ne s&apos;applique qu&apos;au premier achat concerné.</li>
        </ul>
      </Section>
      <Section title="4. Durée et échéance">
        <p>
          L&apos;abonnement prend effet à la confirmation du paiement et s&apos;arrête à son échéance, sans
          reconduction automatique. À l&apos;échéance, l&apos;accès à l&apos;espace de l&apos;entreprise est
          suspendu jusqu&apos;au renouvellement ; les données sont conservées. Des rappels sont envoyés avant
          l&apos;échéance. Les paiements en ligne de loyers effectués par les locataires restent possibles.
        </p>
      </Section>
      <Section title="5. Remboursement">
        <p>
          Le Client peut demander le remboursement de son dernier paiement dans les 15 jours qui suivent
          celui-ci. La demande est examinée par {LEGAL.name} ; si elle est acceptée, le remboursement est effectué
          sous déduction des frais du prestataire de paiement, après transmission par le Client de ses
          coordonnées de réception. L&apos;abonnement concerné prend alors fin.
        </p>
      </Section>
      <Section title="6. Données du Client">
        <p>
          Les données saisies par le Client restent sa propriété et sous sa responsabilité (notamment l&apos;information
          de ses propres locataires et employés). {LEGAL.name} les traite selon la politique de confidentialité.
        </p>
      </Section>
      <Section title="7. Obligations et usage interdit">
        <p>
          Le Client utilise le service conformément à la loi, ne tente pas d&apos;accéder aux données d&apos;un
          autre client, ne perturbe pas le service et ne le revend pas sans accord écrit. En cas de manquement
          grave, l&apos;accès peut être suspendu.
        </p>
      </Section>
      <Section title="8. Disponibilité et responsabilité">
        <p>
          {LEGAL.name} met en œuvre les moyens raisonnables pour assurer un service continu et sécurisé, sans
          garantie d&apos;absence d&apos;interruption. Les calculs et documents produits aident à la gestion mais ne
          remplacent pas l&apos;avis d&apos;un comptable ou d&apos;un juriste. La responsabilité de {LEGAL.name}
          est limitée au montant payé pour la période d&apos;abonnement en cours, sauf faute lourde ou dol.
        </p>
      </Section>
      <Section title="9. Modification des conditions">
        <p>
          Ces conditions peuvent évoluer ; la version en vigueur est celle publiée sur cette page, et la version
          acceptée à l&apos;inscription est conservée.
        </p>
      </Section>
      <Section title="10. Droit applicable">
        <p>Les présentes conditions sont soumises au droit béninois. À défaut d&apos;accord amiable, les tribunaux compétents de Cotonou seront saisis.</p>
      </Section>
    </LegalPage>
  );
}
