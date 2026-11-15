import { router } from 'expo-router';

import { createCameraTools } from '../agentTools';
import type { CameraController, KeptPhoto } from '../CameraController';
import { setActiveCamera, setPendingPhoto } from '../host';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const kept: KeptPhoto = { uri: 'file:///upload.jpg', width: 1536, height: 2048, mimeType: 'image/jpeg', description: 'A red mug on a desk.', altText: 'A red mug.', source: 'camera' };

beforeEach(() => {
  setActiveCamera(null);
  setPendingPhoto(null);
  (router.push as jest.Mock).mockClear();
});

describe("the agent's camera tool, answered in the app's own words", () => {
  it('says the camera is closed and how to open it when there is no photo waiting', () => {
    expect(createCameraTools().run('flip', null)).toEqual({ result: expect.stringMatching(/^CAMERA_CLOSED/), speak: "The camera isn't open. Say open the camera to use it." });
  });

  it('with a photo in a draft: take another reopens the camera and says the draft stays until a new photo replaces it', () => {
    setPendingPhoto(kept);
    const outcome = createCameraTools().run('retake', null);
    expect(outcome.speak).toBe('Opening the camera. Your draft stays until you keep a new photo, which replaces it.');
    expect(router.push).toHaveBeenCalledWith({ pathname: '/camera', params: {} });
  });

  it('with a photo in a draft: describe reads its description again', () => {
    setPendingPhoto(kept);
    expect(createCameraTools().run('describe', null).speak).toBe('The photo in your draft shows A red mug on a desk.');
    setPendingPhoto({ ...kept, description: null });
    expect(createCameraTools().run('describe', null).speak).toMatch(/no description/);
  });

  it('with a photo in a draft: keep, close and anything else say what happened to the draft', () => {
    setPendingPhoto(kept);
    const tools = createCameraTools();
    expect(tools.run('keep', null).speak).toMatch(/already kept/);
    expect(tools.run('close', null).speak).toMatch(/still waiting in your draft/);
    expect(tools.run('flip', null).speak).toMatch(/still waiting in your draft/);
  });

  it('runs the action on an open camera, which speaks for itself', () => {
    const camera = { flip: jest.fn(), answerConsent: jest.fn() } as unknown as CameraController;
    setActiveCamera(camera);
    const tools = createCameraTools();
    expect(tools.run('flip', null)).toEqual({ result: expect.stringMatching(/^DONE/) });
    tools.run('descriptions_off', null);
    expect(camera.answerConsent).toHaveBeenCalledWith('no');
    expect(tools.isOpen()).toBe(true);
    expect(tools.run('open', null).speak).toBe('The camera is already open.');
  });

  it('clears only the photo that was used', () => {
    setPendingPhoto(kept);
    const tools = createCameraTools();
    tools.photoUsed('file:///other.jpg');
    expect(tools.photo()?.uri).toBe('file:///upload.jpg');
    tools.photoUsed('file:///upload.jpg');
    expect(tools.photo()).toBeNull();
  });
});
