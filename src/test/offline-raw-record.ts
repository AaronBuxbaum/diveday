export function rawStoredRecord(tripId: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("diveday-offline-manifests", 1);
    request.onsuccess = () => {
      const db = request.result;
      const getRequest = db
        .transaction("manifests", "readonly")
        .objectStore("manifests")
        .get(tripId);
      getRequest.onsuccess = () => {
        db.close();
        resolve(getRequest.result);
      };
      getRequest.onerror = () => reject(getRequest.error);
    };
    request.onerror = () => reject(request.error);
  });
}
