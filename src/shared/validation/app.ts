// Zodスキーマ。Mainだけがimportする（Preload / Rendererへ持ち込まない）。
import { z } from 'zod'

// app.getInfoは引数を受け取らない。
export const appGetInfoArgsSchema = z.tuple([])
