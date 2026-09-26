require("dotenv").config();

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const OWNER = process.env.GITHUB_OWNER;
const REPO = process.env.GITHUB_REPO;
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN;

const MAX_FILE_SIZE_MB = Number(
  process.env.MAX_FILE_SIZE_MB || 5
);

const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

if (!TOKEN || !OWNER || !REPO) {
  console.error(
    "ERRO: configure GITHUB_TOKEN, GITHUB_OWNER e GITHUB_REPO."
  );

  process.exit(1);
}

const upload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  },

  fileFilter: (req, file, callback) => {
    if (!ALLOWED_TYPES.has(file.mimetype)) {
      return callback(
        new Error(
          "Formato inválido. Use JPG, PNG ou WEBP."
        )
      );
    }

    callback(null, true);
  }
});

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "UBER JÁ Image API",
    status: "online"
  });
});

app.get("/health", (req, res) => {
  res.json({
    success: true,
    status: "healthy"
  });
});

function extensionFromMime(mime) {
  switch (mime) {
    case "image/jpeg":
      return "jpg";

    case "image/png":
      return "png";

    case "image/webp":
      return "webp";

    default:
      return null;
  }
}

function createFileName(extension) {
  const id = crypto.randomBytes(12).toString("hex");

  return `${Date.now()}-${id}.${extension}`;
}

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,

    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      message: text
    };
  }

  if (!response.ok) {
    const error = new Error(
      data.message || "Erro na GitHub API."
    );

    error.status = response.status;
    error.github = data;

    throw error;
  }

  return data;
}

app.post(
  "/upload",
  upload.single("image"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "Envie uma imagem no campo 'image'."
        });
      }

      const extension = extensionFromMime(
        req.file.mimetype
      );

      if (!extension) {
        return res.status(400).json({
          success: false,
          error: "Formato de imagem não permitido."
        });
      }

      const fileName = createFileName(extension);

      const filePath = `images/${fileName}`;

      const base64 = req.file.buffer.toString("base64");

      const githubUrl =
        `https://api.github.com/repos/` +
        `${encodeURIComponent(OWNER)}/` +
        `${encodeURIComponent(REPO)}/` +
        `/contents/${filePath}`;

      const result = await githubRequest(
        githubUrl,
        {
          method: "PUT",

          body: JSON.stringify({
            message: `Upload de imagem: ${fileName}`,
            content: base64,
            branch: BRANCH
          })
        }
      );

      const rawUrl =
        `https://raw.githubusercontent.com/` +
        `${OWNER}/${REPO}/${BRANCH}/${filePath}`;

      return res.status(201).json({
        success: true,

        file: {
          name: fileName,
          path: filePath,
          size: req.file.size,
          type: req.file.mimetype
        },

        github: {
          sha: result.content?.sha || null,
          commit: result.commit?.sha || null
        },

        url: rawUrl
      });

    } catch (error) {
      console.error("UPLOAD ERROR:", error);

      if (error.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          success: false,
          error:
            `A imagem ultrapassa o limite de ` +
            `${MAX_FILE_SIZE_MB} MB.`
        });
      }

      if (error.status === 401 || error.status === 403) {
        return res.status(502).json({
          success: false,
          error: "GitHub recusou a autenticação ou permissão."
        });
      }

      if (error.status === 404) {
        return res.status(502).json({
          success: false,
          error:
            "Repositório não encontrado ou sem permissão."
        });
      }

      return res.status(500).json({
        success: false,
        error: "Não foi possível enviar a imagem."
      });
    }
  }
);

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        success: false,
        error:
          `A imagem ultrapassa o limite de ` +
          `${MAX_FILE_SIZE_MB} MB.`
      });
    }
  }

  if (error.message) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }

  next(error);
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint não encontrado."
  });
});

app.listen(PORT, () => {
  console.log(
    `UBER JÁ Image API rodando na porta ${PORT}`
  );

  console.log(
    `Repositório: ${OWNER}/${REPO}`
  );
});