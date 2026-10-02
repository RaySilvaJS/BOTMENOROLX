const axios = require("axios");
const fs = require("fs");
const path = require("path");

const LOFYPAY_URL = "https://app.lofypay.com/api/v1";

// Lê direto do disco para que o comando /lofypay valha sem reiniciar
function lerLofyPay() {
  try {
    const cfg = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "config.json"), "utf8"),
    );
    return cfg.lofypay && cfg.lofypay.secretKey ? cfg.lofypay : null;
  } catch {
    return null;
  }
}

function lerPreco() {
  try {
    const pub = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "public", "config.json"), "utf8"),
    );
    return Number(String(pub.preco).replace(",", "."));
  } catch {
    return NaN;
  }
}

function erroLofy(error, padrao) {
  const data = error.response?.data;
  console.error("❌ Erro LofyPay:", error.response?.status, data || error.message);
  return {
    status: error.response?.status || 500,
    error: data?.message || data?.error || error.message || padrao,
  };
}

/**
 * Cria uma cobrança PIX no LofyPay (POST /gateway)
 * @param {string} referencia - identificador da venda (external_reference)
 * @returns {Promise<{idTransaction, pixTitle, imgBase64}|{status, error}>}
 */
async function gerarQRCode(referencia) {
  const lofy = lerLofyPay();
  if (!lofy) {
    return { status: 500, error: "LofyPay não configurado. Use /lofypay no bot." };
  }

  const amount = lerPreco();
  if (!(amount > 0)) {
    return { status: 500, error: "Preço inválido em public/config.json" };
  }

  try {
    const response = await axios.post(
      `${LOFYPAY_URL}/gateway`,
      {
        amount,
        method: "pix",
        external_reference: String(referencia || `OLX-${Date.now()}`),
        client: {
          name: "Cliente OLX",
          document: "00000000000",
          email: "cliente@olx.com.br",
        },
      },
      {
        headers: {
          Authorization: `Bearer ${lofy.secretKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    );

    const { paymentCode, paymentCodeBase64, idTransaction } = response.data || {};
    if (!paymentCode || !idTransaction) {
      console.error("❌ Resposta LofyPay inesperada:", response.data);
      return { status: 500, error: "LofyPay não retornou o código PIX" };
    }

    // O campo pode vir como base64 puro, data URI ou URL de imagem (ou nem vir);
    // sem imagem, a página gera o QR a partir do copia e cola.
    let imgBase64 = null;
    if (paymentCodeBase64) {
      imgBase64 = /^(data:|https?:\/\/)/i.test(paymentCodeBase64)
        ? paymentCodeBase64
        : `data:image/png;base64,${paymentCodeBase64}`;
    }

    return { idTransaction, pixTitle: paymentCode, imgBase64 };
  } catch (error) {
    return erroLofy(error, "Erro ao gerar PIX LofyPay");
  }
}

/**
 * Consulta o status de uma cobrança (POST /status)
 * @returns {Promise<{pago: boolean, status: string}|{status: number, error: string}>}
 *   status: WAITING_FOR_APPROVAL | PAID_OUT | EXPIRED | REFUNDED | FAILED
 */
async function consultarStatus(idTransaction) {
  const lofy = lerLofyPay();
  if (!lofy) {
    return { status: 500, error: "LofyPay não configurado" };
  }

  try {
    const response = await axios.post(
      `${LOFYPAY_URL}/status`,
      { idtransaction: idTransaction },
      {
        headers: {
          Authorization: `Bearer ${lofy.secretKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      },
    );

    const status = response.data?.status;
    return { pago: status === "PAID_OUT", status };
  } catch (error) {
    return erroLofy(error, "Erro ao consultar status LofyPay");
  }
}

module.exports = {
  gerarQRCode,
  consultarStatus,
};
