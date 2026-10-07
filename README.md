<img width="1903" height="926" alt="image" src="https://github.com/user-attachments/assets/0c26de65-53cc-4577-862e-5a5068d038bf" /># CalcInk ✍️

> Offline AI-Powered Digital Math Notebook, Reactive Equation Solver & 2D Curve Grapher.

CalcInk is a web-based mathematical canvas that recognizes handwritten equations offline in real time, automatically evaluates mathematical expressions and algebraic variable assignments, plots 2D function curves, and renders solutions directly onto the canvas in natural handwriting typography.

---

## Quick Start (Local Setup)

### Prerequisites
- **Node.js**: v18.0.0 or later (tested on Node.js v20+)
- **npm**: v9.0.0 or later

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone <repository-url>
cd CalcInk
npm install
```

### 2. Development Server
Start the local Vite development server:
```bash
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

### 3. Unit Tests
Run the evaluator and variable memory test suite:
```bash
npm test
```

### 4. Code Quality & Linting
Run the fast Oxlint linter:
```bash
npm run lint
```

### 5. Production Build
Compile TypeScript and create an optimized production bundle:
```bash
npm run build
```
The output will be placed in the `dist/` directory, ready for deployment on Vercel, Netlify, or any static hosting service.

---

## Model Attribution & AI Architecture

CalcInk operates **100% locally and offline in the browser** without sending handwriting data to any external server. Inference is powered by an ensemble of specialized deep neural networks executing via ONNX Runtime WebAssembly.

| Model / Component | Source Link | License | Architecture | Primary Role |
| :--- | :--- | :--- | :--- | :--- |
| **Symbolizer ResNet** (`residualcnn_augment_int8.onnx`) | [Zimya Symbolizer](https://github.com/zimya/symbolizer) / [Symbolizer Web](https://symbolizer.pages.dev) | MIT License | Quantized 8-bit Residual Convolutional Neural Network (ResNet) with residual skip-connections; input shape `[1, 3, 32, 32]` (NCHW); 1,024-class output logits mapped via `mappings.json`. | Mathematical operators (`+`, `-`, `*`, `/`, `=`, `^`), variables (`x`, `y`), decimals (`.`), and scientific notations. |
| **MNIST Digit Classifier** (`mnist-12.onnx`) | [ONNX Model Zoo (MNIST)](https://github.com/onnx/models/tree/main/validated/vision/classification/mnist) | Apache 2.0 | Convolutional Neural Network (CNN) featuring 2 Convolutional layers, ReLU activations, Max Pooling, Dropout, and Dense linear classification layers; input shape `[1, 1, 28, 28]` (NCHW). | High-precision recognition of handwritten numerals `0` through `9`. |
| **Inference Runtime Engine** | [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | MIT License | High-performance WebAssembly (`wasm`) backend leveraging SIMD vectorization and background Web Worker execution. | Browser-native hardware-accelerated model execution without GPU requirements. |

### Recognition & Ensemble Pipeline
1. **Stroke Capture & Vectorization**: Ink strokes are captured with high-DPI coordinate normalization and pressure dynamics.
2. **Spatial Line Banding & Clustering**: Strokes are grouped into discrete symbols and organized left-to-right into lines based on spatial proximity.
3. **Dual-Tensor Rasterization**: Each symbol stroke cluster is rasterized onto offscreen canvases into two normalized inputs:
   - $28 \times 28$ grayscale Float32 tensor for MNIST.
   - $32 \times 32$ RGB Float32 tensor for Symbolizer ResNet.
4. **Intelligent Ensemble Decision**:
   - High-probability digits ($0-9$) are resolved by the MNIST classifier.
   - Operators, decimal points, and variables ($+$, $-$, $\times$, $/$, $=$, $x$, $y$) are resolved by the Symbolizer ResNet.
   - Ambiguous symbols are validated against deterministic geometric heuristics (aspect ratio, stroke count, intersection geometry).
5. **Background Web Worker**: All neural inference and rasterization executes in a dedicated Web Worker (`src/recognition/recognition.worker.ts`), maintaining a responsive 60 FPS drawing experience on the main thread.

---

## Project Structure

```text
CalcInk/
│
├── src/
│   ├── components/                 # Modular UI Views & Controls
│   │   ├── LatexReadingStrip.tsx   # Live rendered KaTeX preview & status bar
│   │   ├── LatexReadingStrip.css
│   │   ├── LeftSidebar.tsx         # Slide-out Notebook Tools (History, Color, Pen Size, Variables)
│   │   ├── LeftSidebar.css
│   │   ├── ResultModal.tsx         # Calculation result details & raw LaTeX inspect modal
│   │   ├── ResultModal.css
│   │   ├── RightGraphSidebar.tsx   # Interactive 2D Cartesian function grapher
│   │   └── RightGraphSidebar.css
│   │
│   ├── math/                       # Mathematics & Spatial Analysis
│   │   ├── curveDetection.ts       # 2D curve detection & analytical function sampling
│   │   ├── evaluator.ts            # Mathematical parser, BODMAS/PEMDAS evaluator & variable scope
│   │   ├── geometry.ts             # Bounding boxes & scratch-out scribble gesture recognition
│   │   └── segmentation.ts         # Line banding, spatial clustering & symbol sequencing
│   │
│   ├── recognition/                # Offline Neural Recognition Engine
│   │   ├── model.ts                # ONNX session manager, stroke rasterizer & ensemble classifier
│   │   ├── multiSymbol.ts          # Multi-symbol equation builder & recognition coordinator
│   │   ├── recognition.worker.ts   # Dedicated Web Worker for off-thread neural inference
│   │   └── workerClient.ts         # Main-thread promise-based Web Worker client bridge
│   │
│   ├── App.css                     # Main notebook layout & canvas viewport styles
│   ├── App.tsx                     # Core application orchestrator, canvas events & toolbar
│   ├── index.css                   # Global base CSS & reset
│   ├── main.tsx                    # Application entry point
│   └── test_evaluator.ts           # Comprehensive evaluator & variable memory test suite
│
├── public/
│   ├── models/                     # Offline Pretrained ONNX Models & Label Mappings
│   │   ├── mappings.json           # LaTeX symbol mapping dictionary
│   │   ├── mnist-12.onnx           # ONNX Model Zoo MNIST digit classifier (26 KB)
│   │   └── residualcnn_augment_int8.onnx # Quantized Symbolizer ResNet model (1.56 MB)
│   ├── ort/                        # ONNX Runtime WebAssembly binaries (.wasm & .mjs)
│   └── favicon.svg                 # Application favicon
│
├── package.json                    # Project dependencies & scripts
├── vite.config.ts                  # Vite build configuration
├── tsconfig.json                   # TypeScript configuration
├── tsconfig.app.json               # Application TypeScript rules
├── tsconfig.node.json              # Vite Node TypeScript rules
├── .oxlintrc.json                  # Linter configuration
├── .gitignore                      # Git ignored files (node_modules, dist, logs)
└── README.md                       # Project documentation & model attribution
```

---

## Core Features

1. **Natural Handwriting Recognition**:
   - Real-time offline recognition using quantized neural networks running directly in your browser.
   - Evaluates arithmetic, multi-digit numbers, decimals, exponents, and variables.

2. **Sequential Variable Memory Scope**:
   - Assign variables naturally: write `x = 10` or `y = 20`.
   - Recall and compute in subsequent lines: `x + y = 30` or `2x + 5 = 25`.
   - View, copy, and clear variables inside the slide-out **Notebook Tools** drawer.

3. **Interactive 2D Curve Graphing**:
   - Automatically detects 2D function curves such as $y = x^2 - 4$.
   - Dedicated Cartesian coordinate plane with pan/zoom, grid ticks, $x$-intercept roots, and extrema readouts.

4. **Continuous Handwriting on the Same Line**:
   - Answers render in natural handwriting typography right after the equals sign.
   - You can continue writing immediately on the same line (e.g. `2 + 3 = 5 + 4 = 9`).

5. **Scratch-Out / Scribble Erase Gesture**:
   - Cross out any mistake with a quick zigzag scratch-out motion to erase it instantly, just like real paper.

6. **Paint-Style Dynamic Cursors**:
   - Custom crosshair Pen cursor for drawing and cell Eraser box cursor for erasing.

7. **Paper Styles & Themes**:
   - 4 paper styles: **Lined**, **Grid**, **Dots**, and **Blank**.
   - **Dark Mode** and **Light Mode** support with smooth color theme persistence.

---

## Deployment Link
https://calcink-one.vercel.app



