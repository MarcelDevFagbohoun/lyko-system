import { redirect } from "next/navigation";

/** Le menu « Salaires » a été fusionné dans « Paiements » (un seul endroit pour payer et retrouver les reçus). */
export default function SalairesPage() {
  redirect("/espace/paiements");
}
