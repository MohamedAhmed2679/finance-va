const DRIVE_FILE_NAME = 'financeva_backup.json';

// --- GOOGLE DRIVE ---
export async function syncToGoogleDrive(stateJson: string, accessToken: string) {
    // 1. Find if file exists
    const findRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${DRIVE_FILE_NAME}' and trashed=false&spaces=appDataFolder`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const findData = await findRes.json();
    const existingFile = findData.files?.[0];

    const metadata = {
        name: DRIVE_FILE_NAME,
        parents: ['appDataFolder']
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([stateJson], { type: 'application/json' }));

    if (existingFile) {
        // Update
        return fetch(`https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=multipart`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: form
        });
    } else {
        // Create
        return fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` },
            body: form
        });
    }
}

export async function fetchFromGoogleDrive(accessToken: string) {
    const findRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${DRIVE_FILE_NAME}' and trashed=false&spaces=appDataFolder`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const findData = await findRes.json();
    const fileId = findData.files?.[0]?.id;

    if (!fileId) return null;

    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    return res.json();
}

// --- MICROSOFT ONEDRIVE ---
export async function syncToOneDrive(stateJson: string, accessToken: string) {
    return fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${DRIVE_FILE_NAME}:/content`, {
        method: 'PUT',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: stateJson
    });
}

export async function fetchFromOneDrive(accessToken: string) {
    const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${DRIVE_FILE_NAME}:/content`, {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    return res.json();
}

// --- APPLE iCLOUD (CloudKit) ---
// Note: Requires CloudKit JS library loaded and configured
export async function syncToICloud(stateJson: string) {
    if (typeof (window as any).CloudKit === 'undefined') {
        throw new Error('CloudKit JS not loaded');
    }
    const container = (window as any).CloudKit.getDefaultContainer();
    const db = container.privateCloudDatabase;

    // Abstracted for brevity - standard CloudKit CRUD
    const record = {
        recordType: 'Backup',
        recordName: 'financeva_backup',
        fields: {
            data: { value: stateJson }
        }
    };

    return db.saveRecords([record]);
}
