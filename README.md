# CueTrack

CueTrack é uma aplicação web mobile-first para rastrear, em tempo real, a bola branca de uma mesa de sinuca usando a câmera traseira de um smartphone.

Todo o processamento acontece localmente no navegador. Não há backend, upload de vídeo ou telemetria remota.

## Demo

GitHub Pages: `https://paulohvieira.github.io/cuetrack/`

## MVP atual

- câmera traseira no Chrome Android;
- vídeo com Canvas sobreposto;
- OpenCV.js para processamento local;
- segmentação da bola branca em HSV;
- contornos filtrados por área, tamanho, proporção e circularidade;
- centro X,Y e raio da melhor candidata;
- trajetória das últimas 100 posições;
- FPS em tempo real;
- thresholds HSV ajustáveis;
- processamento limitado a 640 px de largura e 30 FPS;
- velocidade instantânea em `px/s`;
- velocidade máxima e média;
- componentes `Vx` e `Vy`;
- aceleração/desaceleração em `px/s²`;
- distância acumulada em pixels;
- tempo em movimento;
- estado `SEM DETECÇÃO`, `PARADA` ou `MOVIMENTO`;
- velocímetro visual;
- HUD de velocidade que acompanha a bola;
- vetor de velocidade desenhado sobre o vídeo.

## Telemetria de velocidade

A velocidade usa a distância entre centros detectados e o tempo real entre frames:

```text
velocidade = distância_em_pixels / intervalo_em_segundos
```

O cálculo usa timestamps reais do navegador, portanto não depende de assumir que o celular mantém exatamente 30 FPS.

Para reduzir ruído causado por pequenas oscilações na detecção, CueTrack aplica:

- zona morta para deslocamentos muito pequenos;
- suavização temporal de `Vx`, `Vy` e aceleração;
- limiar com histerese para distinguir bola parada e em movimento;
- rejeição de saltos de posição incompatíveis com uma trajetória plausível.

A velocidade permanece em pixels por segundo porque esta versão ainda não possui calibração dimensional. Valores em `m/s` ou `km/h` exigem conhecer a escala da imagem em relação à mesa real.

## Como usar

1. Abra a aplicação no Chrome Android por HTTPS.
2. Toque em **Iniciar câmera**.
3. Autorize o acesso à câmera traseira.
4. Aponte a câmera para a mesa mantendo a bola branca visível.
5. Ajuste HSV se necessário.
6. Movimente a bola e acompanhe velocidade, vetor, máximas, médias, distância e tempo.
7. Use **Limpar trajetória** para zerar trajetória e telemetria da sessão.

Valores HSV iniciais:

| Canal | Mínimo | Máximo |
| --- | ---: | ---: |
| H | 0 | 179 |
| S | 0 | 80 |
| V | 180 | 255 |

## Execução local

O acesso à câmera exige contexto seguro. Em desenvolvimento, `localhost` é permitido:

```bash
python -m http.server 8000
```

Depois abra:

```text
http://localhost:8000
```

Para testar pelo celular usando o IP da máquina na rede local, HTTP simples normalmente não é suficiente para `getUserMedia`. Use HTTPS ou GitHub Pages.

O OpenCV.js é carregado do CDN oficial, portanto a primeira abertura requer conexão com a internet.

## GitHub Pages

O projeto é totalmente estático e não possui etapa de build.

Publicação:

```text
branch: main
pasta: /
```

A presença de `.nojekyll` evita processamento desnecessário pelo Jekyll. Todos os caminhos são relativos e funcionam em `paulohvieira.github.io/cuetrack/`.

## Estrutura

```text
.
├── .nojekyll
├── index.html
├── styles.css
├── app.js
└── README.md
```

## Fora do escopo desta versão

- outras bolas;
- previsão de trajetória;
- colisões;
- velocidade em m/s ou km/h;
- calibração dimensional.

## Limitações

A velocidade em `px/s` depende do enquadramento, resolução de processamento, distância e ângulo da câmera. Portanto, ela é adequada para acompanhar o movimento dentro da mesma sessão, mas ainda não representa uma velocidade física comparável entre montagens diferentes.

Reflexos fortes, tacos, bordas claras e objetos brancos podem gerar falsos positivos. Iluminação uniforme, câmera estável e enquadramento predominante do pano melhoram a detecção.

## Privacidade

`getUserMedia`, OpenCV.js e Canvas operam no próprio navegador. O projeto não possui backend, telemetria remota, armazenamento ou upload de imagens.
