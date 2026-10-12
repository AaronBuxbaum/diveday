import type { TideStationEcho } from "@/lib/tide-stations";
import type { SiteFieldValues } from "./SiteFields";

/** Carysfort Reef beside Molasses Reef: the pairing a Key Largo shop actually wants. */
export const NEAR: TideStationEcho = {
  id: "8723583",
  name: "Carysfort Reef",
  state: "FL",
  latitude: 25.2217,
  longitude: -80.2117,
  distanceKm: 28.6,
  far: false,
};

/** Vaca Key at Marathon on the same reef: seven digits, answers, eighty kilometres off. */
export const FAR: TideStationEcho = {
  id: "8723970",
  name: "Vaca Key",
  state: "FL",
  latitude: 24.7113,
  longitude: -81.1065,
  distanceKm: 80.9,
  far: true,
};

/**
 * A stored site as the edit page hands it over, so a test can say what the
 * shop has already answered. The blank-form tests below pass no values at all,
 * which is the new-site page's own shape.
 */
export const STORED: SiteFieldValues = {
  name: "Molasses Reef",
  forecastLatitude: 25.0106,
  forecastLongitude: -80.3764,
  tideStationId: "8723583",
  tideStationConfirmed: false,
  tidePreference: "any",
  locationName: null,
  description: null,
  satelliteImageUrl: null,
  routeImageUrl: null,
  routePoints: [],
  routeLabel: null,
  routeNote: null,
  routeZoom: 15,
  imageUrls: [],
  marineLife: null,
  marineLifeDescription: null,
  difficultyLevel: null,
  depthRange: null,
  maxDepthMeters: null,
  expectedBottomTimeMinutes: null,
  currentNote: null,
  divePlan: null,
  conservationNote: null,
  fitTone: null,
  fitNote: null,
  fieldGuideTipsHeading: null,
  landmarks: [],
  creatures: [],
  minimumCertificationLevel: null,
  requiredSpecialties: [],
  requiresNitrox: false,
  planningNote: null,
  planningNoteAt: null,
};
