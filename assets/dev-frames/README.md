# Development camera frames

Stand-in camera frames for the look actions (`convex/look.ts`). `pnpm eval:look` sends each one through `describeImage` and `decide`, and the app can use them as fake camera frames through `index.ts`. All are JPEG, 768 x 1024, under 150 KB. Nobody in them is a real person.

| File | Meant to test | How it was made |
| --- | --- | --- |
| `face-centered.jpg` | one face in the middle of the frame, well lit | AI-generated portrait of a fictional person against a plain wall (landscape, 1264 x 848), cropped to 3:4 with the face centered, scaled to 768 x 1024 |
| `face-left.jpg` | the face well left of center | the same portrait, cropped so the face sits at a quarter of the width |
| `face-right.jpg` | the face well right of center | the same portrait, cropped so the face sits at three quarters of the width |
| `blurred.jpg` | strong motion blur | AI-generated street scene with a yellow bicycle, cropped to 3:4, then a 61-pixel horizontal box blur and a 4-pixel Gaussian blur with Pillow |
| `dark.jpg` | a very underexposed indoor scene | AI-generated living room, cropped to 3:4, then linear brightness × 0.12 after a 2.2 gamma, plus faint noise, with Pillow and NumPy |
| `sign-text.jpg` | legible text read exactly | AI-generated brick shop front with a blank sign panel; the text ("MAPLE STREET / BAKERY / Fresh bread daily" and a card reading "OPEN / 7am - 6pm") was drawn on it with Pillow in DejaVu Serif Bold and DejaVu Sans Bold, so it is exact |
| `cut-off.jpg` | a mug cut off by the right edge | AI-generated red mug on a wooden desk, cropped so the right edge of the frame runs through the mug and its handle |

The source pictures were generated on 2026-11-15 with Google's Gemini 3.1 Flash Image (Nano Banana 2) through Capy's image tool; the prompts asked for a fictional person and for no text or logos. Google's terms do not claim ownership of generated images, and these are contributed to this repository on the same terms as its code. The fonts are DejaVu (Bitstream Vera licence, free to use and embed).
