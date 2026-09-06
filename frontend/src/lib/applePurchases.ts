import { Platform } from "react-native";
import type { CustomerInfo, PurchasesPackage } from "react-native-purchases";

const IOS_PUBLIC_API_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || "";
const PLUS_ENTITLEMENT_ID =
  process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID || "plus";

let configuredUserId: string | null = null;

async function purchasesModule() {
  if (Platform.OS !== "ios") {
    throw new Error("Apple purchases are only available on iPhone and iPad.");
  }
  if (!IOS_PUBLIC_API_KEY) {
    throw new Error("Apple subscriptions are not configured yet.");
  }
  return import("react-native-purchases");
}

export function isApplePurchaseConfigured(): boolean {
  return Platform.OS === "ios" && Boolean(IOS_PUBLIC_API_KEY);
}

export async function configureApplePurchases(userId: string) {
  const { default: Purchases } = await purchasesModule();
  if (!configuredUserId) {
    Purchases.configure({ apiKey: IOS_PUBLIC_API_KEY, appUserID: userId });
    configuredUserId = userId;
  } else if (configuredUserId !== userId) {
    await Purchases.logIn(userId);
    configuredUserId = userId;
  }
  return Purchases;
}

export async function getAppleMonthlyPackage(
  userId: string,
): Promise<PurchasesPackage | null> {
  const Purchases = await configureApplePurchases(userId);
  const offerings = await Purchases.getOfferings();
  const packages = offerings.current?.availablePackages || [];
  return (
    packages.find(
      (item) =>
        item.packageType === "MONTHLY" ||
        item.identifier.toLowerCase().includes("monthly"),
    ) ||
    packages[0] ||
    null
  );
}

export function hasApplePlus(customerInfo: CustomerInfo): boolean {
  return Boolean(customerInfo.entitlements.active[PLUS_ENTITLEMENT_ID]);
}

export async function purchaseApplePackage(
  userId: string,
  selectedPackage: PurchasesPackage,
): Promise<CustomerInfo> {
  const Purchases = await configureApplePurchases(userId);
  const result = await Purchases.purchasePackage(selectedPackage);
  return result.customerInfo;
}

export async function restoreApplePurchases(
  userId: string,
): Promise<CustomerInfo> {
  const Purchases = await configureApplePurchases(userId);
  return Purchases.restorePurchases();
}

export async function disconnectApplePurchases(): Promise<void> {
  if (!configuredUserId || Platform.OS !== "ios" || !IOS_PUBLIC_API_KEY) return;
  const { default: Purchases } = await purchasesModule();
  await Purchases.logOut();
  configuredUserId = null;
}

export function wasApplePurchaseCancelled(error: unknown): boolean {
  return Boolean((error as { userCancelled?: boolean } | null)?.userCancelled);
}
