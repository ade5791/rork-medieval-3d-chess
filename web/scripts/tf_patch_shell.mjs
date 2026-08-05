// Review mode in GameShell: skip the intro and drop straight into a staged
// board so a capture is reproducible. Inert without a review query string.
import fs from "node:fs";

const file = "C:/Users/Tks_Toledo/clawd/projects/rork-medieval-3d-chess/web/src/ui/GameShell.tsx";
let src = fs.readFileSync(file, "utf8");
const nl = src.includes("\r\n") ? "\r\n" : "\n";
const L = (...lines) => lines.join(nl);
const log = [];

function patch(name, find, replace) {
  if (!src.includes(find)) { log.push(name + ": MISS"); return; }
  src = src.replace(find, replace);
  log.push(name + ": OK");
}

if (!src.includes("readReviewState")) {
  patch(
    "import",
    'import { detectQualityPreset, type QualityPreset } from "../scene/quality";',
    L(
      'import { detectQualityPreset, type QualityPreset } from "../scene/quality";',
      'import { readReviewState } from "../scene/reviewState";',
    ),
  );
}

if (!src.includes("const review = useMemo")) {
  patch(
    "state",
    "  const detected = useMemo<QualityPreset>(() => detectQualityPreset(), []);",
    L(
      "  const review = useMemo(() => readReviewState(), []);",
      "  const detected = useMemo<QualityPreset>(",
      "    () => review.quality ?? detectQualityPreset(),",
      "    [review.quality],",
      "  );",
    ),
  );

  // seed settings from the review state so the pinned arena/quality is honoured
  patch(
    "settings",
    "    quality: detected,\n    arena: DEFAULT_ARENA,".replace(/\n/g, nl),
    L("    quality: detected,", "    arena: review.arena ?? DEFAULT_ARENA,"),
  );
}

// Skip the intro cinematic under review, and auto-start a staged match.
if (!src.includes("review.review")) {
  patch(
    "intro",
    L(
      "    void engine.load().then(async () => {",
      "      setIntroPlaying(true);",
      "      await engine.playIntro();",
      "      setIntroPlaying(false);",
      "    });",
    ),
    L(
      "    void engine.load().then(async () => {",
      "      // Review capture: no intro, no attract, straight to a staged board so",
      "      // every screenshot of a build lands on the identical frame.",
      "      if (review.review) {",
      "        engine.setInteractive(true);",
      "        engine.setCameraPreset(\"white\");",
      "        controller.start({",
      "          mode: \"hotseat\",",
      "          difficulty: \"medium\",",
      "          playerColor: \"w\",",
      "          clockMinutes: null,",
      "        });",
      "        setPhase(\"playing\");",
      "        return;",
      "      }",
      "      setIntroPlaying(true);",
      "      await engine.playIntro();",
      "      setIntroPlaying(false);",
      "    });",
    ),
  );

  patch(
    "deps",
    "  }, [controller, detected]);",
    "  }, [controller, detected, review.review]);",
  );
}

// Never run attract mode during a review capture.
patch(
  "attract",
  "    if (phase !== \"menu\" || attract || introPlaying) return;",
  "    if (review.review || phase !== \"menu\" || attract || introPlaying) return;",
);
patch(
  "attractdeps",
  "  }, [phase, attract, introPlaying, scheduleAttract]);",
  "  }, [phase, attract, introPlaying, scheduleAttract, review.review]);",
);

fs.writeFileSync(file, src);
console.log(log.join("\n"));
