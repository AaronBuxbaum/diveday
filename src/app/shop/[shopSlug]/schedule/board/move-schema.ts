import { z } from "zod";

export const moveSchema = z.object({ tripId: z.uuid(), date: z.string(), startTime: z.string() });
