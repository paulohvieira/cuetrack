# CueTrack

CueTrack é um MVP web mobile-first que usa a câmera traseira de um smartphone para rastrear, em tempo real, a bola branca de uma mesa de sinuca.

Todo o processamento acontece localmente no navegador. O vídeo não é gravado, enviado ou processado por um servidor.

## Funcionalidades

- acesso à câmera traseira pelo Chrome Android;
- vídeo com Canvas sobreposto;
- segmentação da bola branca no espaço de cor HSV com OpenCV.js;
- filtro de contornos por área, tamanho, proporção e circularidade;
- marcação do contorno e do centro da melhor candidata;
- trajetória das últimas 100 posições relevantes;
- contador de FPS;
- limpeza manual da trajetória;
- ajuste dos limites mínimos e máximos de H, S e V;
- processamento limitado a 640 px de largura e 30 FPS para reduzir o custo no celular.

## Executar localmente

O acesso à câmera exige um contexto seguro. Use `localhost` durante o desenvolvimento em vez de abrir o arquivo diretamente:

```bash
python -m http.server 8000
```

Depois, abra `http://localhost:8000` no navegador. Para testar em um celular pela rede local, use HTTPS (ou publique temporariamente no GitHub Pages), porque o Chrome bloqueia a câmera em origens HTTP que não sejam `localhost`.

O OpenCV.js é carregado do CDN oficial e, por isso, a primeira abertura requer conexão com a internet.

## Como usar

1. Abra a aplicação no Chrome Android.
2. Toque em **Iniciar câmera** e permita o acesso.
3. Aponte a câmera traseira para a mesa, mantendo a bola branca visível.
4. Se necessário, abra **Ajustar detecção HSV**. Para uma bola branca, use saturação baixa e brilho alto.
5. Toque em **Limpar trajetória** para reiniciar o rastro.

Os valores iniciais são:

| Canal | Mínimo | Máximo |
| --- | ---: | ---: |
| H (matiz) | 0 | 179 |
| S (saturação) | 0 | 80 |
| V (brilho) | 180 | 255 |

## Publicar no GitHub Pages

O projeto é totalmente estático e não precisa de build.

1. Envie os arquivos para um repositório no GitHub.
2. Em **Settings → Pages**, selecione **Deploy from a branch**.
3. Escolha a branch `main`, a pasta `/ (root)` e salve.
4. Abra a URL HTTPS fornecida pelo GitHub Pages no Chrome Android.

Os caminhos dos recursos são relativos, então a aplicação funciona tanto em um domínio raiz quanto em uma URL de projeto, como `usuario.github.io/cue-track/`.

## Estrutura

```text
.
├── index.html   # interface e carregamento do OpenCV.js
├── styles.css   # layout responsivo mobile-first
├── app.js       # câmera, visão computacional e desenho no Canvas
└── README.md
```

## Escopo atual

Esta primeira versão detecta apenas a bola branca. Ainda não inclui outras bolas, previsão de trajetória, colisões, velocidade em m/s ou calibração dimensional.

Reflexos fortes, tacos, bordas claras e partes brancas do ambiente podem gerar falsos positivos. Iluminação uniforme, câmera estável e enquadramento predominante do pano melhoram o resultado.

## Privacidade

`getUserMedia`, OpenCV.js e Canvas operam no próprio navegador. O projeto não possui backend, telemetria, armazenamento ou upload de imagens.
