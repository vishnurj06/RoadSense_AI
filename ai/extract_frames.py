import os
import cv2
import sys

def extract_frames(video_path, output_dir, every_n_frames=15):
    os.makedirs(output_dir, exist_ok=True)
    cap = cv2.VideoCapture(video_path)
    
    if not cap.isOpened():
        print(f"Error: Could not open video file {video_path}")
        return

    frame_idx = 0
    saved = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % every_n_frames == 0:
            cv2.imwrite(os.path.join(output_dir, f"frame_{saved:04d}.jpg"), frame)
            saved += 1
        frame_idx += 1
    cap.release()
    print(f"Extracted {saved} frames")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python extract_frames.py <video_path>")
    else:
        video_path = sys.argv[1]
        extract_frames(video_path, "test_images")
