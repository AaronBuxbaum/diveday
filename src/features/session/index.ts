/** session public contract. Internals are imported only within this module. */

export type { ShopSurface, ShopSurfaceGate, ShopSurfaceOptions } from "./rules";
export { isLiveShopStaff, requireShopSurface, requireStaffSession } from "./rules";
