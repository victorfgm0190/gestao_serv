// Alias de /api/nfse-download-pdf-oficial — o nome curto da especificação.
//
// ⚠️ O handler é UM SÓ, reexportado. Uma segunda cópia nasceria com a sondagem
// do portal, a checagem do `%PDF-` e o 503 com a alternativa em duplicidade —
// e uma das duas ficaria para trás no dia em que a rota do DANFSE for
// publicada. É o mesmo desenho de
// `payable-payments?action=calculate-distribution`, alias de
// `payables-victor?action=calcular-distribuicao`: dois caminhos, um handler.
export { default } from './nfse-download-pdf-oficial.js'
