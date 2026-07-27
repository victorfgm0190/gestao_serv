// Vocabulário das obrigações fiscais, compartilhado pelas telas.
//
// `das`, `inss` e `honorarios` são gerados pelo ?action=apurar. `pro_labore` e
// `escritorio` vieram da migração de victor_reserves e são lançados à mão — a apuração
// não os recalcula, então sobrevivem a uma reapuração.
//
// Mora aqui porque a memória de cálculo (componente compartilhado) e a tela /fiscal
// precisam das mesmas etiquetas: duas cópias divergiriam na primeira renomeação.
export const KIND_LABEL = {
  das: 'DAS',
  inss: 'INSS',
  honorarios: 'Honorários',
  pro_labore: 'Pró-labore',
  escritorio: 'Escritório',
}
