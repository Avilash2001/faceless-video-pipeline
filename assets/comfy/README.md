# ComfyUI workflows

`image_t2i.json` and `image_edit.json` ship ready to use with **FLUX.2 klein 4B (distilled)**. They were tested against ComfyUI 0.42 and expect these files from [Comfy-Org/Flux-2-Klein-4B](https://huggingface.co/Comfy-Org/Flux-2-Klein-4B/tree/main/split_files):

| File | ComfyUI folder | Size |
|---|---|---|
| `flux-2-klein-4b.safetensors` | `models/diffusion_models/` | 7.75 GB |
| `qwen_3_4b.safetensors` | `models/text_encoders/` | 8.04 GB |
| `flux2-vae.safetensors` | `models/vae/` | 0.34 GB |

`image_edit.json` attaches up to two character reference sheets. For other models, or for video, replace these with your own **API-format** exports (in ComfyUI: File → Export (API)):

| File | Used for | Suggested template |
|---|---|---|
| `image_t2i.json` | Character sheets and scenes without recurring characters | `image_flux2_klein_text_to_image` |
| `image_edit.json` (optional) | Scenes with recurring characters (character sheets attached as references) | `image_flux2_klein_image_edit_4b_distilled` |
| `video_i2v.json` (optional) | Motion clips when `MOTION_PROVIDER=comfyui` | `video_wan2_2_14B_i2v` |

File names can be changed with `COMFYUI_IMAGE_WORKFLOW`, `COMFYUI_IMAGE_EDIT_WORKFLOW` and `COMFYUI_VIDEO_WORKFLOW`.

## How inputs are filled in

Usually nothing needs editing. The pipeline finds:

- the prompt: the text-encoder node feeding the sampler's `positive` (or `conditioning`) input; the `negative` one gets the negative prompt,
- every `seed` / `noise_seed`,
- every node with both `width` and `height` (set from `COMFYUI_IMAGE_*` / `COMFYUI_VIDEO_*`),
- `length` (frame count) for video,
- `LoadImage` nodes, in node-id order, for reference images or the start frame.

If a workflow needs something different, put placeholders in the JSON instead and they take over:
`"{{PROMPT}}"`, `"{{NEGATIVE}}"`, `"{{SEED}}"`, `"{{WIDTH}}"`, `"{{HEIGHT}}"`, `"{{FRAMES}}"`, `"{{IMAGE_1}}"`, `"{{IMAGE_2}}"`…
