import { getDb } from "@/db/client";
import { isLiveShopStaff } from "@/features/accounts/session";
import { currentPrivatePersonPhoto } from "@/features/people/person-photo";
import { auth } from "@/lib/auth";
import {
  PRIVATE_PERSON_PHOTO_PREFIX,
  privatePersonPhotoNotFound,
  privatePersonPhotoResponse,
} from "@/lib/person-photo";
import { mediaStorageConfigFromEnvironment, readS3Object } from "@/lib/storage";
import { isUuid } from "@/lib/uuid";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ personId: string; assetId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user) return privatePersonPhotoNotFound();
    const { personId, assetId } = await params;
    if (!isUuid(personId) || !/^[A-Za-z0-9_-]{22}\.jpg$/.test(assetId))
      return privatePersonPhotoNotFound();
    const db = await getDb();
    const shopId = session.user.shopId;
    if (!(await isLiveShopStaff(db, shopId, session))) return privatePersonPhotoNotFound();
    const url = await currentPrivatePersonPhoto(db, shopId, personId, assetId);
    if (!url) return privatePersonPhotoNotFound();
    const config = mediaStorageConfigFromEnvironment();
    if (!config.success) return privatePersonPhotoNotFound();
    const object = await readS3Object(url, config.data, { prefix: PRIVATE_PERSON_PHOTO_PREFIX });
    return object.ok ? privatePersonPhotoResponse(object) : privatePersonPhotoNotFound();
  } catch {
    return privatePersonPhotoNotFound();
  }
}
