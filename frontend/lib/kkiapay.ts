/**
 * Widget de paiement KKiaPay — chargé depuis leur CDN officiel
 * (https://cdn.kkiapay.me/k.js), jamais empaqueté : ni la page du portail
 * locataire, ni la page publique de paiement ne chargent ce script tant que
 * l'entreprise concernée n'a pas activé le paiement en ligne.
 *
 * `reference` : notre identifiant interne (`t<tenantId>:rent:<leaseId>` /
 * `t<tenantId>:charge:<chargeId>` / `t<tenantId>:link:<token>`), posé à la
 * fois dans `data` et `partnerId` du widget — c'est ce que le webhook
 * (backend/src/routes/kkiapayWebhook.js) relit pour savoir à quelle
 * entreprise/quel paiement une confirmation se rapporte.
 */
type KkiapayWindow = Window & {
  openKkiapayWidget?: (options: {
    amount: string;
    key: string;
    sandbox: boolean;
    position: string;
    data: string;
    partnerId: string;
  }) => void;
  addSuccessListener?: (cb: (response: { transactionId?: string }) => void) => void;
  addFailedListener?: (cb: (error: { message?: string }) => void) => void;
};

let scriptPromise: Promise<void> | null = null;

function loadKkiapayScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Indisponible côté serveur"));
  if ((window as KkiapayWindow).openKkiapayWidget) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.kkiapay.me/k.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Impossible de charger le module de paiement KKiaPay"));
      document.body.appendChild(script);
    });
  }
  return scriptPromise;
}

export type KkiapayWidgetResult = { transactionId: string };

export async function payWithKkiapay(options: {
  amount: number;
  publicKey: string;
  sandbox: boolean;
  reference: string;
}): Promise<KkiapayWidgetResult> {
  await loadKkiapayScript();
  const w = window as KkiapayWindow;

  return new Promise((resolve, reject) => {
    // Le SDK ne documente pas de retrait d'écouteur : le dernier appel
    // gagne, suffisant pour un widget modal utilisé une fois à la fois.
    w.addSuccessListener?.((response) => {
      if (response?.transactionId) resolve({ transactionId: response.transactionId });
      else reject(new Error("Réponse KKiaPay inattendue (transactionId manquant)"));
    });
    w.addFailedListener?.((error) => {
      reject(new Error(error?.message || "Paiement annulé ou échoué"));
    });
    w.openKkiapayWidget?.({
      amount: String(Math.round(options.amount)),
      key: options.publicKey,
      sandbox: options.sandbox,
      position: "center",
      data: options.reference,
      partnerId: options.reference,
    });
  });
}
