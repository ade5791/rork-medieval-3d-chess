#!/usr/bin/env bash
#
# Rewrite every commit message in this repository into English.
#
# The project history was written in Vietnamese before the open-source release.
# This script maps each original commit to an English Conventional Commits message
# (see CONTRIBUTING.md) and leaves anything it does not recognise untouched.
#
#   ./scripts/rewrite-commit-messages.sh
#
# WARNING — this rewrites history:
#   * every commit hash changes;
#   * pushing afterwards requires `git push --force-with-lease`;
#   * anyone with an existing clone has to re-clone.
# Run it on a fresh public repository before you share it, or coordinate with
# everyone who has a clone. The script refuses to run on a dirty tree and keeps
# the original refs under refs/original/ so you can roll back.
#
set -euo pipefail

cd "$(dirname "$0")/.."

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: not inside a git repository" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "error: working tree is dirty — commit or stash your changes first" >&2
  exit 1
fi

echo "This rewrites ALL commit messages and therefore ALL commit hashes."
read -r -p "Continue? [y/N] " reply
case "$reply" in
  y | Y | yes | YES) ;;
  *)
    echo "aborted"
    exit 0
    ;;
esac

export FILTER_BRANCH_SQUELCH_WARNING=1

git filter-branch -f --msg-filter '
case "$GIT_COMMIT" in
43da777f6a34026570425502bb7680003cab2da9) echo "chore: scaffold the medieval 3D chess project" ;;
ff80f15cf3b2ce5f117706ffddd250616b06383d) echo "feat: cinematic 3D chess in a castle hall with three difficulties" ;;
feb85ead1dbfe3de6a016449367da4c48ba296ec) echo "fix: black screen on load and complete the game loop" ;;
473649171ebbeb63eaa3a51bc5ec3dcd1c633169) echo "feat(pieces): battle animations for the 3D figures and render fixes" ;;
b1a31b58e4b3d2fc5a8c3e346f86abd7b170b027) echo "feat(scene): fighting figures and a battlefield backdrop" ;;
88f2677fe86093acfbedf9ff983538f2494ce829) echo "feat(pieces): animated character models, weapons and battlefield props" ;;
40ec90681e362a29cc582d739732a9bdc5106540) echo "chore: interrupted work in progress" ;;
3d30d855113e957eeb7251959186336576ccddda) echo "feat: battlefield effects, piece weapons and control fixes" ;;
9303099087d561d4b45a29e21cddd9deeaef3925) echo "feat(pieces): medieval warrior sculpts and battle effects" ;;
f7adcab54fb939cc4e98168dd93b6b01a0b22cc6) echo "feat: finish the warrior sculpts and combat effects" ;;
12f163ff8f1dc4f598346c791a7401efcbcacbeb) echo "feat(scene): combat effects and medieval staging" ;;
e805d08320320e6dd2f2ad30db248dce47d6c754) echo "feat: new graphics and gameplay features" ;;
72c8353a7f775ed28ce506b3ed8a01f2ee9bb340) echo "feat(ui): animated warriors, combat effects and the move ledger" ;;
564672170b948c2a180357f018e7e32b446251c5) echo "feat: combat effects and a reworked interface" ;;
69368ef640a0268e92ef209737275c570be3ee76) echo "feat: animated warrior pieces, combat effects and control fixes" ;;
8eb708320afe5cce27d72a19d0339748196e3b15) echo "feat: animated pieces, a livelier battlefield and better controls" ;;
a18e073448bcc2be6e809927976fffdf8965f592) echo "feat: complete the animated warriors and battle effects" ;;
725a64c28e6846ab0dcff8a193039fa6a54ecd67) echo "chore: recover from an interrupted generation" ;;
a90d96687d7eae671d78456c06c3b9d01a68e594) echo "feat: graphics, combat effects and the auto-camera showcase" ;;
f05a88644a9ee23079683733107cb5c2721babc5) echo "feat: overhaul the 3D pieces, combat effects and interface" ;;
6e58199a4cbe38217669efcaea4325028e416350) echo "feat(scene): new battlefield staging, refreshed pieces and UI polish" ;;
baf0c966f090f3ba845bc225836e481bcf9f1b43) echo "feat: interface overhaul, combat effects and a new piece set" ;;
ae9d47708419c56684809804c9f66f932de788f3) echo "feat: graphics, combat effects and interface overhaul" ;;
29ff5706dd4a95e360c1254c3c5df00ca4a8aa40) echo "feat: UI, visual effects and a showcase mode for the 3D board" ;;
93394cd94f8230b1caf8ddf6d75a2b56e0e5e37f) echo "feat: livelier visuals, a second faction and the jungle battleground" ;;
cdb7294fa29c107b69b6315704598000d7a365dc) echo "feat: new UI, the Sun Temple battleground and the 2D tactical view" ;;
950e73990fe22dec032e2df6495ff782bc6f0bae) echo "feat: piece visuals, new battlegrounds and punchier combat audio" ;;
91d571d325048673b625f76cc89df0f42d783423) echo "feat: UI, a new battleground and a reworked piece and audio system" ;;
7a14faa57afff36983e118b881833154b716e7ba) echo "feat: roomier UI, a new piece set and the tropical jungle map" ;;
5b1f45e26293eaffd3bcfe290fca7bf0a3d332b7) echo "feat: UI polish, refreshed pieces and richer audio-visual effects" ;;
d1dda988fd25b85ced98f7adbf68f452c7f02671) echo "feat: piece graphics, sound effects and extra battlegrounds" ;;
47f2a9cddeba97353691a66809dfa8730c189183) echo "feat: board UI, a new battleground and richer audio-visual effects" ;;
bd396ce22fc66bdaecd30036c77a4b3f3454edc1) echo "feat: new UI, richer audio and the self-playing showcase mode" ;;
c1b1db4b45c30c1ad753d8352f2fae35df742a78) echo "feat: showcase mode, new pieces and an audio-visual overhaul" ;;
ebea32384f428b06a751b0f1545ea5e6b9d74b58) echo "feat: showcase mode, restyled pieces, jungle map and better effects" ;;
f61607aa67cd8965424f8098d7beca2ac42deb6d) echo "feat: self-play mode, a new piece look and richer effects" ;;
0913257d88642cdac5bb60f67bbfddf8517721b7) echo "feat: crimson army restyle, the green jungle map and richer effects" ;;
a980a0af29cfa2c7ea88cbd97855b86c84d80640) echo "feat: new pieces, the jungle battleground and livelier audio" ;;
d503ccd49d08c2492000f22bc9b7fc7e92a4c720) echo "feat: restyled pieces, the jungle battleground and richer audio" ;;
aa34bda008baeeae5d11a40e9fda00fc5faeb4b9) echo "feat: new characters, the jungle battleground and livelier audio" ;;
1df72b9359cc5f23974923fffb179ef813c8d0bf) echo "chore: interrupted work in progress" ;;
*) cat ;;
esac
' -- --all

echo
echo "Done. Review the result with:"
echo "  git log --oneline"
echo
echo "Roll back with:"
echo "  git reset --hard refs/original/refs/heads/main"
echo
echo "Publish with:"
echo "  git push --force-with-lease origin main"
