# CueTrack

CueTrack é um MVP web mobile-first para rastrear, em tempo real, a bola branca de uma mesa de sinuca usando a câmera traseira de um smartphone.

Todo o processamento acontece localmente no navegador. Não há backend, upload de vídeo ou telemetria.

## Demo

GitHub Pages: `https://paulohvieira.github.io/cuetrack/`

## MVP atual

- acesso à câmera traseira pelo Chrome Android;
- vídeo ocupando a área principal da interface;
- Canvas sobreposto ao vídeo;
- processamento com OpenCV.js;
- conversão RGB → HSV;
- segmentação da bola branca por thresholds HSV ajustáveis;
- busca de contornos candidatos;
- filtros por área, tamanho, proporção e circularidade;
- seleção da melhor candidata com pequeno bônus de continuidade espacial;
- cálculo do centro X,Y;
- círculo e ponto central sobre a bola detectada;
- armazenamento das últimas 100 posições;
- desenho da trajetória;
- contador de FPS;
- botão para limpar a trajetória;
- processamento limitado a 640 px de largura e 30 FPS para reduzir carga no smartphone.

## Como usar

1. Abra a aplicação no Chrome Android por HTTPS.
2. Toque em **Iniciar câmera**.
3. Autorize o acesso à câmera.
4. Aponte a câmera para a mesa mantendo a bola branca visível.
5. Se necessário, abra **Ajustar detecção HSV** e ajuste os limites.
6. Use **Limpar trajetória** para apagar o rastro acumulado.

Valores HSV iniciais:

| Canal | Mínimo | Máximo |
| --- | ---: | ---: |
| H | 0 | 179 |
| S | 0 | 80 |
| V | 180 | 255 |

Para objetos brancos, normalmente funciona melhor manter a saturação baixa e o brilho alto.

## Execução local

O acesso à câmera exige contexto seguro. Em desenvolvimento, `localhost` é permitido:

```bash
python -m http.server 8000
```

Depois abra:

```text
http://localhost:8000
```

Para testar pelo celular usando o IP da máquina na rede local, HTTP simples normalmente não é suficiente para `getUserMedia`. Use HTTPS ou o GitHub Pages.

O OpenCV.js é carregado do CDN oficial, portanto a primeira abertura requer conexão com a internet.

## GitHub Pages

O projeto é totalmente estático e não possui etapa de build.

A publicação deste repositório está configurada a partir de:

```text
branch: main
pasta: /
```

A presença de `.nojekyll` evita processamento desnecessário pelo Jekyll.

Todos os caminhos utilizados pela aplicação são relativos, portanto funcionam corretamente em `paulohvieira.github.io/cuetrack/`.

## Estrutura

```text
.
├── .nojekyll
├── index.html
├── styles.css
├── app.js
└── README.md
```

O projeto permanece intencionalmente pequeno: HTML5, CSS, JavaScript puro, Canvas e OpenCV.js.

## Escopo não implementado

Esta versão não inclui:

- rastreamento das outras bolas;
- previsão de trajetória;
- detecção de colisões;
- cálculo de velocidade em m/s;
- calibração dimensional.

## Limitações conhecidas

A detecção atual é baseada principalmente em cor e geometria. Reflexos, tacos, bordas claras e objetos brancos podem gerar falsos positivos.

Iluminação uniforme, câmera relativamente estável e enquadramento predominante do pano da mesa tendem a melhorar o resultado.

## Privacidade

`getUserMedia`, OpenCV.js e Canvas operam no próprio navegador. Nenhum frame é enviado para servidor pelo CueTrack.
