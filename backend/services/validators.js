/**
 * Valida CPF pelo algoritmo padrão de dígito verificador (módulo 11).
 * Só confere o formato/matemática — não confirma que a pessoa é dona do CPF.
 */
function isValidCPF(cpf) {
  const digits = String(cpf || '').replace(/\D/g, '');
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false; // todos os digitos iguais (000.000.000-00 etc)

  const calcCheckDigit = (base) => {
    let sum = 0;
    let weight = base.length + 1;
    for (const d of base) {
      sum += Number(d) * weight;
      weight--;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const d1 = calcCheckDigit(digits.slice(0, 9));
  const d2 = calcCheckDigit(digits.slice(0, 10));
  return d1 === Number(digits[9]) && d2 === Number(digits[10]);
}

module.exports = { isValidCPF };
