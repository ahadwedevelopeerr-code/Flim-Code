const client = window.flimcodeSupabase;
const loginPanel = document.getElementById("loginPanel");
const dashboard = document.getElementById("dashboard");
const loginError = document.getElementById("loginError");

const safe = value => String(value ?? "").replace(/[&<>"']/g, character => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
}[character]));

function showLoginError(message) {
  loginError.textContent = message;
}

async function isFilmAdmin() {
  const { data, error } = await client.rpc("is_film_admin");
  if (error) throw error;
  return data === true;
}

async function enterDashboard() {
  await renderRows();
  loginPanel.classList.add("d-none");
  dashboard.classList.remove("d-none");
}

document.getElementById("loginBtn").onclick = async () => {
  if (!client) {
    showLoginError("Supabase is not configured. Follow the setup steps in README.md.");
    return;
  }

  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value;
  showLoginError("");

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    showLoginError(`Sign-in failed: ${error.message}`);
    return;
  }

  try {
    if (!await isFilmAdmin()) {
      await client.auth.signOut();
      showLoginError("This account is not authorized as a film admin.");
      return;
    }
    await enterDashboard();
  } catch (adminError) {
    showLoginError(`Could not verify admin access: ${adminError.message}`);
  }
};

document.getElementById("adminPassword").addEventListener("keydown", event => {
  if (event.key === "Enter") document.getElementById("loginBtn").click();
});

document.getElementById("logoutBtn").onclick = async () => {
  const { error } = await client.auth.signOut();
  if (error) {
    document.getElementById("formStatus").textContent = `Logout failed: ${error.message}`;
    return;
  }
  dashboard.classList.add("d-none");
  loginPanel.classList.remove("d-none");
};

async function renderRows() {
  const { data, error } = await client
    .from("films")
    .select("id,title,genre,hot,featured,image_path,video_path")
    .order("created_at", { ascending: false });
  if (error) throw error;

  const rows = document.getElementById("adminFilmRows");
  document.getElementById("adminCount").textContent = `${data.length} films`;
  rows.innerHTML = data.map(film => {
    const poster = client.storage.from("film-assets").getPublicUrl(film.image_path).data.publicUrl;
    return `<tr>
      <td><img class="admin-poster" src="${safe(poster)}" alt=""></td>
      <td>${safe(film.title)}</td>
      <td>${safe(film.genre)}</td>
      <td>${film.hot ? "<span class='badge text-bg-danger'>Hot</span>" : ""} ${film.featured ? "<span class='badge text-bg-primary'>Slider</span>" : ""}</td>
      <td><button class="btn btn-sm btn-outline-danger" data-delete="${safe(film.id)}"><i class="bi bi-trash"></i> Delete</button></td>
    </tr>`;
  }).join("") || '<tr><td colspan="5" class="text-center text-white-50 py-4">No shared films yet. Add your first film above.</td></tr>';
}

document.getElementById("adminFilmRows").addEventListener("click", async event => {
  const button = event.target.closest("[data-delete]");
  if (!button || !confirm("Delete this film from the shared catalogue?")) return;

  const { data: film, error: readError } = await client
    .from("films")
    .select("id,image_path,video_path")
    .eq("id", button.dataset.delete)
    .single();
  if (readError) {
    document.getElementById("formStatus").textContent = `Could not load film: ${readError.message}`;
    return;
  }

  const { error: deleteError } = await client.from("films").delete().eq("id", film.id);
  if (deleteError) {
    document.getElementById("formStatus").textContent = `Delete failed: ${deleteError.message}`;
    return;
  }

  const paths = [film.image_path, film.video_path].filter(Boolean);
  if (paths.length) {
    const { error: storageError } = await client.storage.from("film-assets").remove(paths);
    if (storageError) {
      document.getElementById("formStatus").textContent = `Film deleted, but its files could not be removed: ${storageError.message}`;
    }
  }
  await renderRows();
});

function makeStoragePath(kind, file) {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const filename = file.name.replace(/[^\w.-]/g, "_");
  return `${unique}-${kind}-${filename}`;
}

async function uploadAsset(storage, path, file, label, status) {
  const resumableThreshold = 6 * 1024 * 1024;
  const contentType = file.type || "application/octet-stream";
  if (file.size <= resumableThreshold) {
    const { error } = await storage.upload(path, file, {
      contentType,
      upsert: false
    });
    if (error) throw error;
    return;
  }

  if (!window.tus) throw new Error("Resumable upload support could not load. Check your internet connection and try again.");
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw sessionError;
  if (!session) throw new Error("Your admin session has expired. Sign in again before uploading.");

  await new Promise((resolve, reject) => {
    const upload = new window.tus.Upload(file, {
      endpoint: `${window.FLIMCODE_SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/upload/resumable`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: window.FLIMCODE_SUPABASE_ANON_KEY,
        "x-upsert": "false"
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: resumableThreshold,
      metadata: {
        bucketName: "film-assets",
        objectName: path,
        contentType,
        cacheControl: "3600"
      },
      onError: reject,
      onProgress(bytesUploaded, bytesTotal) {
        const percentage = Math.round(bytesUploaded / bytesTotal * 100);
        status.textContent = `Uploading ${label}: ${percentage}%`;
      },
      onSuccess: resolve
    });

    upload.findPreviousUploads()
      .then(previousUploads => {
        if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
        upload.start();
      })
      .catch(reject);
  });
}

document.getElementById("filmForm").addEventListener("submit", async event => {
  event.preventDefault();
  const status = document.getElementById("formStatus");
  const submitButton = event.target.querySelector('button[type="submit"]');
  const uploadedPaths = [];
  let saved = false;
  submitButton.disabled = true;
  status.textContent = "Uploading files...";

  try {
    const poster = document.getElementById("poster").files[0];
    const video = document.getElementById("movieFile").files[0];
    if (!poster) throw new Error("Please choose a poster image.");

    const storage = client.storage.from("film-assets");
    const imagePath = makeStoragePath("poster", poster);
    await uploadAsset(storage, imagePath, poster, "poster", status);
    uploadedPaths.push(imagePath);

    let videoPath = null;
    if (video) {
      videoPath = makeStoragePath("video", video);
      await uploadAsset(storage, videoPath, video, "video", status);
      uploadedPaths.push(videoPath);
    }

    const { data: posterUrl } = storage.getPublicUrl(imagePath);
    const videoUrl = videoPath ? storage.getPublicUrl(videoPath).data.publicUrl : null;
    const { error } = await client.from("films").insert({
      title: document.getElementById("title").value.trim(),
      genre: document.getElementById("genre").value,
      year: Number(document.getElementById("year").value) || new Date().getFullYear(),
      rating: document.getElementById("rating").value.trim(),
      description: document.getElementById("description").value.trim(),
      image_path: imagePath,
      image_url: posterUrl.publicUrl,
      video_path: videoPath,
      video_url: videoUrl,
      hot: document.getElementById("hot").checked,
      featured: document.getElementById("featured").checked
    });
    if (error) throw error;
    saved = true;

    event.target.reset();
    document.getElementById("year").value = new Date().getFullYear();
    status.textContent = "Film uploaded. It is now available to all visitors.";
    await renderRows();
  } catch (error) {
    if (!saved && uploadedPaths.length) {
      const { error: cleanupError } = await client.storage.from("film-assets").remove(uploadedPaths);
      if (cleanupError) console.error("Could not clean up incomplete film upload:", cleanupError);
    }
    status.textContent = `${saved ? "Film uploaded, but the list could not refresh" : "Upload failed"}: ${error.message || "Unknown error"}`;
  } finally {
    submitButton.disabled = false;
  }
});

async function restoreSession() {
  if (!client) {
    showLoginError("Supabase is not configured. Follow the setup steps in README.md.");
    return;
  }

  const { data, error } = await client.auth.getSession();
  if (error) {
    showLoginError(`Could not check sign-in: ${error.message}`);
    return;
  }
  if (!data.session) return;

  try {
    if (await isFilmAdmin()) await enterDashboard();
    else await client.auth.signOut();
  } catch (adminError) {
    showLoginError(`Could not verify admin access: ${adminError.message}`);
  }
}

restoreSession().catch(error => showLoginError(`Admin page failed to load: ${error.message}`));
