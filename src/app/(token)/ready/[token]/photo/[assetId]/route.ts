import { getDb } from "@/db/client";
import { getDiverPhotoForCapability } from "@/features/people/person-photo";
import { privatePersonPhotoNotFound, privatePersonPhotoResponse } from "@/lib/person-photo";
import { mediaStorageConfigFromEnvironment, readS3Object } from "@/lib/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string; assetId: string }> },
) {
  try {
    const { token, assetId } = await params;
    const photo = await getDiverPhotoForCapability(await getDb(), { token, assetId });
    if (!photo) return privatePersonPhotoNotFound();
    const config = mediaStorageConfigFromEnvironment();
    if (!config.success) return privatePersonPhotoNotFound();
    const object = await readS3Object(photo.url, config.data, { prefix: "private-person-photos" });
    return object.ok ? privatePersonPhotoResponse(object) : privatePersonPhotoNotFound();
  } catch {
    return privatePersonPhotoNotFound();
  }
}
