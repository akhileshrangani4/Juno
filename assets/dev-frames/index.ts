// Camera frames for testing the look actions without a camera: pnpm eval:look sends each one through
// describeImage and decide, and the app can use them as stand-in frames. How each was made is in README.md.
export const DEV_FRAMES: { name: string; source: number; subject: string | null; meant: string }[] = [
  { name: 'face-centered', source: require('./face-centered.jpg'), subject: 'the face', meant: 'One person facing the camera, face in the middle of the frame, well lit.' },
  { name: 'face-left', source: require('./face-left.jpg'), subject: 'the face', meant: 'The same kind of portrait with the face well left of center.' },
  { name: 'face-right', source: require('./face-right.jpg'), subject: 'the face', meant: 'The same kind of portrait with the face well right of center.' },
  { name: 'blurred', source: require('./blurred.jpg'), subject: 'the bicycle', meant: 'A street scene with strong motion blur: should read as too blurry.' },
  { name: 'dark', source: require('./dark.jpg'), subject: 'the sofa', meant: 'A badly underexposed living room: should read as too dark.' },
  { name: 'sign-text', source: require('./sign-text.jpg'), subject: 'the sign', meant: 'A shop sign with legible text that must be read out exactly.' },
  { name: 'cut-off', source: require('./cut-off.jpg'), subject: 'the mug', meant: 'A mug cut off by the right edge of the frame.' },
];
