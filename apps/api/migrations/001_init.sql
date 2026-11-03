-- Schema inicial. Valores monetários SEMPRE em centavos (bigint).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE condominio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cnpj text,
  multa_bps int NOT NULL DEFAULT 200,          -- 2,00 % de multa
  juros_mensal_bps int NOT NULL DEFAULT 100,   -- 1,00 % ao mês (pro rata dia)
  dia_vencimento int NOT NULL DEFAULT 10 CHECK (dia_vencimento BETWEEN 1 AND 28),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE papel AS ENUM ('sindico','subsindico','tesoureiro','conselho','zelador','morador');

CREATE TABLE usuario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES condominio(id),
  nome text NOT NULL,
  email text NOT NULL UNIQUE,
  telefone text,
  senha_hash text NOT NULL,
  papel papel NOT NULL,
  permissoes_extra text[] NOT NULL DEFAULT '{}',   -- delegações do síndico (ex.: cameras:ver)
  totp_secret text,
  totp_ativo boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE unidade (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES condominio(id),
  identificador text NOT NULL,                   -- ex.: "Casa 12"
  bloco text,
  taxa_centavos bigint NOT NULL DEFAULT 0 CHECK (taxa_centavos >= 0),
  responsavel_nome text,                          -- pagador (usado no PSP)
  responsavel_cpf_cnpj text,
  psp_customer_id text,
  UNIQUE (condominio_id, identificador)
);

CREATE TABLE vinculo (
  usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  unidade_id uuid NOT NULL REFERENCES unidade(id) ON DELETE CASCADE,
  tipo text NOT NULL DEFAULT 'proprietario' CHECK (tipo IN ('proprietario','inquilino','dependente')),
  PRIMARY KEY (usuario_id, unidade_id)
);

CREATE TYPE tipo_mov AS ENUM ('receita','despesa');

CREATE TABLE categoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES condominio(id),
  nome text NOT NULL,
  tipo tipo_mov NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  UNIQUE (condominio_id, nome, tipo)
);

CREATE TABLE conta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES condominio(id),
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('caixa','fundo_reserva')),
  UNIQUE (condominio_id, tipo)
);

CREATE TABLE cobranca (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES condominio(id),
  unidade_id uuid NOT NULL REFERENCES unidade(id),
  competencia date NOT NULL,                       -- sempre dia 1 do mês
  vencimento date NOT NULL,
  valor_centavos bigint NOT NULL CHECK (valor_centavos > 0),
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','paga','cancelada')),
  psp_id text,
  psp_link text,
  pago_em date,
  valor_pago_centavos bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unidade_id, competencia)
);

CREATE TABLE lancamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES condominio(id),
  seq bigserial,
  tipo text NOT NULL CHECK (tipo IN ('entrada','saida')),
  categoria_id uuid NOT NULL REFERENCES categoria(id),
  conta_id uuid NOT NULL REFERENCES conta(id),
  unidade_id uuid REFERENCES unidade(id),
  cobranca_id uuid REFERENCES cobranca(id),
  competencia date NOT NULL,
  data_pagamento date NOT NULL,
  valor_centavos bigint NOT NULL CHECK (valor_centavos > 0),
  descricao text NOT NULL,
  favorecido text,
  estorno_de uuid REFERENCES lancamento(id),
  criado_por uuid REFERENCES usuario(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON lancamento (condominio_id, competencia);
CREATE UNIQUE INDEX lancamento_um_estorno ON lancamento (estorno_de) WHERE estorno_de IS NOT NULL;

-- Livro-caixa imutável: nada é editado ou apagado, correção = estorno.
CREATE FUNCTION bloqueia_alteracao() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Lançamentos são imutáveis: use estorno.';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER lancamento_imutavel BEFORE UPDATE OR DELETE ON lancamento
  FOR EACH ROW EXECUTE FUNCTION bloqueia_alteracao();

CREATE TABLE comprovante (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lancamento_id uuid NOT NULL REFERENCES lancamento(id),
  arquivo text NOT NULL,
  nome_original text,
  mime text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE solicitacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES condominio(id),
  unidade_id uuid REFERENCES unidade(id),
  solicitante_id uuid NOT NULL REFERENCES usuario(id),
  tipo text NOT NULL CHECK (tipo IN ('manutencao','reclamacao','sugestao','segunda_via_boleto','autorizacao_obra','reserva_area','outros')),
  prioridade text NOT NULL DEFAULT 'media' CHECK (prioridade IN ('baixa','media','alta')),
  titulo text NOT NULL,
  descricao text NOT NULL,
  local text,
  status text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','em_analise','em_execucao','concluida','recusada')),
  lancamento_id uuid REFERENCES lancamento(id),
  anexos text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE solicitacao_comentario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  solicitacao_id uuid NOT NULL REFERENCES solicitacao(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuario(id),
  texto text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE camera (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES condominio(id),
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('externa','interna')),
  local text,
  stream_name text NOT NULL,          -- nome do stream no gateway (go2rtc)
  rtsp_cifrado text,                  -- RTSP cifrado (AES-256-GCM); nunca sai da API
  online boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  UNIQUE (condominio_id, stream_name)
);

CREATE TABLE camera_acesso_log (
  id bigserial PRIMARY KEY,
  condominio_id uuid NOT NULL REFERENCES condominio(id),
  camera_id uuid NOT NULL REFERENCES camera(id),
  usuario_id uuid NOT NULL REFERENCES usuario(id),
  inicio timestamptz NOT NULL DEFAULT now(),
  ip text
);

CREATE TABLE canal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condominio_id uuid NOT NULL REFERENCES condominio(id),
  slug text NOT NULL,
  nome text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('geral','avisos','financeiro','manutencao','dm')),
  somente_sindico_escreve boolean NOT NULL DEFAULT false,
  UNIQUE (condominio_id, slug)
);

CREATE TABLE canal_membro (
  canal_id uuid NOT NULL REFERENCES canal(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  PRIMARY KEY (canal_id, usuario_id)
);

CREATE TABLE mensagem (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canal_id uuid NOT NULL REFERENCES canal(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuario(id),
  texto text NOT NULL,
  anexo text,
  responde_a uuid REFERENCES mensagem(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON mensagem (canal_id, created_at DESC);

CREATE TABLE leitura_mensagem (
  mensagem_id uuid NOT NULL REFERENCES mensagem(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES usuario(id) ON DELETE CASCADE,
  lido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (mensagem_id, usuario_id)
);

CREATE TABLE auditoria (
  id bigserial PRIMARY KEY,
  condominio_id uuid NOT NULL REFERENCES condominio(id),
  usuario_id uuid REFERENCES usuario(id),
  acao text NOT NULL,
  entidade text,
  entidade_id text,
  dados jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON auditoria (condominio_id, created_at DESC);
