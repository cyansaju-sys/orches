-- Ejemplo: se ejecuta con el botón ▶ de la franja superior, en la conexión que elijas.
CREATE OR REPLACE FUNCTION fn_total_con_impuesto (p_monto IN NUMBER, p_tasa IN NUMBER) RETURN NUMBER IS
BEGIN
  RETURN ROUND(p_monto * (1 + p_tasa / 100), 2);
END fn_total_con_impuesto;
/

SELECT id_articulo, nombre, fn_total_con_impuesto(precio, 15) AS precio_final
  FROM articulos
 WHERE activo = 'S'
 ORDER BY nombre;
